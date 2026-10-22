"""Plantilla «BD Liquidaciones» de Granos: traduce el detalle crudo de una liquidación de WSLPG a las
41 columnas (A:AO) de la planilla del cliente y la entrega como texto tabulado (para pegar) o .xlsx.

Módulo sin dependencias del resto de la app (solo openpyxl para el .xlsx) y ubicado en la raíz del
proyecto a propósito: lo comparten afip_certs y la demo pública (scripts/publicar_demo.sh lo copia).
"""

from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal
from typing import Any, Optional

HOJA = "BD Liquidaciones"
NCOLS = 41  # A:AO
COL_COE = 5  # E
FILA_ENCABEZADO = 1
PCT_COLS = {23, 32, 34}  # W comisión %, AF ret. IVA %, AH ret. Ganancias % (1-based)

# Códigos de grano de WSLPG confirmados con filas reales. Los desconocidos NO se inventan:
# se escribe el código y se avisa (completar acá o en "granos" de la config del cliente).
CATALOGO_GRANOS = {"19": "Maíz", "22": "Sorgo Granífero", "23": "Soja"}


def D(v: Any) -> Decimal:
    try:
        return Decimal(str(v)) if v not in (None, "") else Decimal(0)
    except Exception:
        return Decimal(0)


def f(v: Decimal) -> float:
    return float(round(v, 2))


def _lista(nodo: Any, clave: str) -> list:
    return ((nodo or {}).get(clave)) or []


def construir_fila(data: dict, vendedor: str, granos: Optional[dict] = None, avisos: Optional[list] = None) -> list:
    """41 columnas (A:AO). Tipos: fecha -> date, importes -> float, porcentajes -> fracción (0.015)."""
    avisos = avisos if avisos is not None else []
    liq, auth = data["liquidacion"], data["autorizacion"]
    sub, iva, total_a = D(auth.get("subTotal")), D(auth.get("importeIva")), D(auth.get("operacionConIva"))

    flete = com = com_iva = reg = otros = Decimal(0)
    iva_gastos = Decimal(0)
    for d in _lista(auth.get("deducciones"), "deduccionReturn"):
        ded = d["deduccion"]
        base, iva_d = D(ded.get("baseCalculo")), D(d.get("importeIva"))
        det = (ded.get("detalleAclaratorio") or "").lower()
        iva_gastos += iva_d
        if ded.get("codigoConcepto") == "CO":
            com += base; com_iva += iva_d
        elif "flete" in det:
            flete += base
        elif "registro" in det:
            reg += base
        else:  # sellos y cualquier otro concepto sin columna propia
            otros += base

    neto_gastos = total_a - (flete + com + reg + iva_gastos + otros)
    esperado = total_a - D(auth.get("totalDeduccion"))
    if abs(neto_gastos - esperado) > Decimal("0.05"):
        avisos.append(f"COE {auth.get('coe')}: neto de gastos {neto_gastos} != A - totalDeduccion {esperado}")

    ret_iva = ret_iva_p = ret_gan = ret_gan_p = ret_iibb = Decimal(0)
    for r in _lista(auth.get("retenciones"), "retencionReturn"):
        det, imp = r["retencion"], D(r.get("importeRetencion"))
        cod = det.get("codigoConcepto")
        if cod == "RI":
            ret_iva, ret_iva_p = imp, D(det.get("alicuota"))
        elif cod == "RG":
            ret_gan, ret_gan_p = imp, D(det.get("alicuota"))
        else:
            ret_iibb += imp
    neto_cobrar = neto_gastos - ret_iva - ret_gan - ret_iibb
    if auth.get("totalNetoAPagar") is not None and abs(neto_cobrar - D(auth["totalNetoAPagar"])) > Decimal("1.01"):
        avisos.append(f"COE {auth.get('coe')}: neto a cobrar calculado {neto_cobrar} != ARCA {auth['totalNetoAPagar']}")

    cod = str(liq.get("codGrano"))
    grano = {**CATALOGO_GRANOS, **(granos or {})}.get(cod)
    if grano is None:
        avisos.append(f"COE {auth.get('coe')}: código de grano {cod} sin nombre en el catálogo (se escribe el código)")
        grano = cod
    camp = str(liq.get("campaniaPPal") or "")
    fecha = auth.get("fechaLiquidacion")
    fila = [
        dt.date.fromisoformat(str(fecha)[:10]) if fecha else "",   # A
        "",                                                        # B Origen (no viene de ARCA)
        vendedor,                                                  # C
        str(liq.get("cuitComprador") or ""),                       # D (CUIT)
        str(auth.get("coe") or ""),                                # E
        "",                                                        # F Contrato (manual)
        "Final",                                                   # G
        f(D(auth.get("totalPesoNeto"))),                           # H
        grano,                                                     # I
        f"{camp[:2]}-{camp[2:]}" if len(camp) == 4 else camp,      # J
        f(D(liq.get("precioRefTn"))),                              # K
        "", "", "",                                                # L M N (tipo de cambio / U$S)
        liq.get("codGradoEnt") or "",                              # O
        f(D(liq.get("factorEnt"))),                                # P
        f(sub), 0.0, f(iva), f(total_a),                           # Q R S T
        f(D(liq.get("precioFleteTn"))), f(flete),                  # U V
        float(com / sub) if sub else 0.0,                          # W comisión %
        f(com), 0.0, 0.0, f(reg),                                  # X Y Z AA
        f(iva_gastos), 0.0, f(otros), f(neto_gastos),              # AB AC AD AE
        float(ret_iva_p / 100), f(ret_iva),                        # AF AG
        float(ret_gan_p / 100), f(ret_gan), f(ret_iibb),           # AH AI AJ
        f(neto_cobrar),                                            # AK
        f(D(auth.get("totalIvaRg4310_18"))),                       # AL
        f(D(auth.get("totalPagoSegunCondicion"))),                 # AM
        0.0,                                                       # AN Reintegro IVA
        liq.get("datosAdicionales") or "",                         # AO
    ]
    assert len(fila) == NCOLS, len(fila)
    return fila


# ------------------------------------------------------------------ Plantilla «BD Liquidaciones» (exportación manual)
ENCABEZADOS = [
    "Fecha Liquidación", "Origen", "Vendedor", "Comprador", "Liq. Número / COE", "Contrato Referencia",
    "Tipo Liquidación", "Kg. Liquidados", "Grano", "Campaña", "Precio Venta $", "Tipo de Cambio",
    "Precio Venta U$S", "Total Liquidación U$S", "Grado", "Factor", "Importe Bruto $ (1)",
    "Diferencia Calidad (2)", "IVA 10,5% (3) = (1+2)", "Total Liquidación (A) = (1+2+3)", "Flete $ (Tn.)",
    "Flete $ (4) 10,5%", "Comisión", "Comisión $ (5) 10,5%", "Der. de Registro (6) 21%", "Almacenaje (10,5%)",
    "Tasa de Registro (6) 21%", "IVA Gastos (7) = (4+5+6)", "Deducción a Cobrar en Final 2,5%",
    "Otros Gastos (8)", "Total Neto de Gastos (B) = (A) - (4+5+6+7+8)", "Porcentaje Retención IVA",
    "Retención IVA 5% (9) = (1+2-4-5-6)", "Porcentaje Retención Ganancias", "Ret. Ganancias (10)",
    "Ret. IIBB Cba (11)", "Total Neto a Cobrar (C) = (A-9-10-11)", "IVA RG 4310/2018 (IVA vía CBU)",
    "Pago según Condiciones", "Reintegro IVA", "Observación",
]
assert len(ENCABEZADOS) == NCOLS


def filas_desde_crudos(crudos, vendedor: str, granos: Optional[dict] = None) -> tuple[list[list], list[str]]:
    """Filas de BD Liquidaciones a partir de (coe, raw_json) + avisos. Una liquidación que no se pueda
    traducir se omite y se avisa, nunca corta la exportación."""
    avisos: list[str] = []
    filas = []
    for coe, raw in crudos:
        if not raw:
            avisos.append(f"COE {coe}: sin detalle guardado (omitida)"); continue
        try:
            filas.append(construir_fila(json.loads(raw), vendedor, granos, avisos))
        except Exception as exc:  # noqa: BLE001
            avisos.append(f"COE {coe}: no se pudo armar la fila ({type(exc).__name__}: {exc}); omitida")
    return filas, avisos


def _num_ar(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def _celda_tsv(i: int, v: Any) -> str:
    if v is None or v == "":
        return ""  # vacía: igual conserva su tabulación para que el pegado caiga en la columna correcta
    if isinstance(v, dt.date):
        return f"{v.day}/{v.month}/{v.year}"
    if i in PCT_COLS:
        return f"{round(v * 100, 2):g}%".replace(".", ",")
    if isinstance(v, float):
        return _num_ar(v)
    return " ".join(str(v).split())  # sin tabs ni saltos de línea que rompan el pegado


def a_tsv(filas: list[list]) -> str:
    """Texto para pegar en la primera celda libre de la columna A: una línea por liquidación, 41 celdas."""
    return "\n".join("\t".join(_celda_tsv(i, v) for i, v in enumerate(fila, start=1)) for fila in filas)


def a_xlsx(filas: list[list]) -> bytes:
    import io
    from openpyxl import Workbook

    libro = Workbook(); ws = libro.active; ws.title = HOJA
    ws.append(ENCABEZADOS)
    for fila in filas:
        ws.append([None if v == "" else v for v in fila])
    for r in range(2, len(filas) + 2):
        for j in range(1, NCOLS + 1):
            c = ws.cell(r, j)
            if isinstance(c.value, dt.date):
                c.number_format = "d/m/yyyy"
            elif j in PCT_COLS:
                c.number_format = "0.00%"
            elif isinstance(c.value, float):
                c.number_format = "#,##0.00"
    salida = io.BytesIO(); libro.save(salida)
    return salida.getvalue()
