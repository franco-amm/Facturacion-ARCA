"""Public-safe, read-only demo app backed only by synthetic fixture data."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import date
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any, Optional

import granos_plantilla  # vive en la raíz: lo comparten afip_certs y el repo público de la demo
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook
from starlette.responses import FileResponse, Response

DEMO_DIR = Path(__file__).resolve().parent / "static" / "demo"
DATA_PATH = DEMO_DIR / "demo-data.json"
MONOTRIBUTO_PATH = DEMO_DIR / "monotributo-demo.json"
MONOTRIBUTO_PROYECCION_PATH = DEMO_DIR / "monotributo-proyeccion-demo.json"
DFE_PATH = DEMO_DIR / "dfe-demo.json"
CCMA_PATH = DEMO_DIR / "ccma-demo.json"
GRANOS_PATH = DEMO_DIR / "granos-demo.json"
EMITIR_PATH = DEMO_DIR / "emitir-demo.json"
EXPORT_FIELDS = [
    ("Fecha", "Fecha"),
    ("Tipo", "TipoDescripcion"),
    ("Punto de venta", "PuntoVenta"),
    ("Numero", "Numero"),
    ("Receptor", "Receptor"),
    ("Documento", "DocNro"),
    ("Importe", "ImpTotal"),
    ("CAE demo", "CAE"),
    ("Vencimiento CAE", "CAEFchVto"),
    ("Asociados", "CbtesAsoc"),
]

app = FastAPI(title="ARCA Billing Demo", version="1.0.0", docs_url=None, redoc_url=None)
app.mount("/assets", StaticFiles(directory=DEMO_DIR), name="demo-assets")


def _dataset() -> dict[str, Any]:
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def _emisor(emisor: Optional[str]) -> dict[str, Any]:
    emisores = _dataset()["emisores"]
    if emisor is None:
        return emisores[0]
    for item in emisores:
        if item["id"] == emisor:
            return item
    raise HTTPException(status_code=404, detail="Emisor de demostración desconocido.")


def _filtered_invoices(
    from_date: date, to_date: date, types: list[int], emisor: Optional[str] = None
) -> list[dict[str, Any]]:
    elegido = _emisor(emisor)["id"]
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="from_date must be on or before to_date.")
    if not types or any(code not in {11, 12, 13} for code in types):
        raise HTTPException(status_code=400, detail="types must be selected from 11, 12, and 13.")
    start = from_date.isoformat()
    end = to_date.isoformat()
    return [
        invoice
        for invoice in _dataset()["invoices"]
        if invoice["Emisor"] == elegido
        and invoice["Fecha"] >= start
        and invoice["Fecha"] <= end
        and int(invoice["TipoComprobante"]) in types
    ]


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(DEMO_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "demo-read-only"}


@app.get("/api/demo/emisores")
def demo_emisores() -> dict[str, Any]:
    """CUIT de demostración con su cantidad de comprobantes ficticios."""
    dataset = _dataset()
    return {
        "mode": "demo",
        "emisores": [
            {**item, "count": sum(1 for inv in dataset["invoices"] if inv["Emisor"] == item["id"])}
            for item in dataset["emisores"]
        ],
    }


@app.get("/api/demo/summary")
def demo_summary(emisor: Optional[str] = None) -> dict[str, Any]:
    elegido = _emisor(emisor)
    invoices = [inv for inv in _dataset()["invoices"] if inv["Emisor"] == elegido["id"]]
    return {
        "mode": "demo",
        "issuer": elegido,
        "count": len(invoices),
        "latest_issue_date": max((invoice["Fecha"] for invoice in invoices), default=None),
        "types": [11, 12, 13],
    }


@app.get("/api/demo/monotributo")
def demo_monotributo() -> dict[str, Any]:
    """Tope y alertas de Monotributo calculados de antemano sobre contribuyentes ficticios."""
    return json.loads(MONOTRIBUTO_PATH.read_text(encoding="utf-8"))


@app.get("/api/demo/monotributo/proyeccion")
def demo_monotributo_proyeccion() -> dict[str, Any]:
    """Topes proyectados a la próxima actualización de ARCA (escala pública, cálculo hecho de antemano)."""
    return json.loads(MONOTRIBUTO_PROYECCION_PATH.read_text(encoding="utf-8"))


_ORDEN = list("ABCDEFGHIJK")
_ESTADO_ORDEN = {"revisar": 0, "atencion": 1, "sin_datos": 2, "al_dia": 3}


def _estado_resumen(uso: Optional[float], deuda: Optional[float], sube: bool, viejo: bool) -> tuple[str, Optional[str]]:
    """Mismos umbrales que el Resumen real (propuestos: 85 % atención, 95 % revisar)."""
    if uso is None:
        return "sin_datos", "Sin facturación sincronizada"
    con_deuda = bool(deuda and deuda > 0)
    if uso >= 0.95:
        return "revisar", "Cerca del tope de la categoría"
    if con_deuda and uso >= 0.85:
        return "revisar", "Deuda en ARCA y uso alto del tope"
    if uso >= 0.85:
        return "atencion", "Uso alto del tope"
    if con_deuda:
        return "atencion", "Deuda en ARCA"
    if sube:
        return "atencion", "Le correspondería otra categoría"
    if viejo:
        return "atencion", "Datos desactualizados"
    return "al_dia", None


def _resumen_base() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    mono = json.loads(MONOTRIBUTO_PATH.read_text(encoding="utf-8"))
    ccma = {c["cuit"]: c for c in json.loads(CCMA_PATH.read_text(encoding="utf-8"))["clientes"]}
    proy = json.loads(MONOTRIBUTO_PROYECCION_PATH.read_text(encoding="utf-8"))
    return mono, ccma, proy


def _fila_resumen(c: dict[str, Any], ccma: dict[str, Any], hoy: str, dfe: Optional[dict[str, dict[str, Any]]] = None) -> dict[str, Any]:
    cuit = c["cuit"]
    categoria, proyectada = c.get("categoria_padron"), c.get("categoria_proyectada")
    sube = bool(categoria in _ORDEN and proyectada in _ORDEN and _ORDEN.index(proyectada) > _ORDEN.index(categoria))
    uso, tope, fact = c.get("uso"), c.get("tope"), c.get("facturacion_periodo")
    deuda_ccma = ccma.get(cuit)
    saldo = deuda_ccma["ultima_deuda"]["saldo_neto"] if deuda_ccma else None
    deuda = None if saldo is None else (-saldo if saldo < 0 else 0.0)
    sync = c.get("sincronizado_el")
    viejo = bool(sync) and (date.fromisoformat(hoy) - date.fromisoformat(sync)).days > 3
    estado, motivo = _estado_resumen(uso, deuda, sube, viejo)
    com = (dfe or {}).get(cuit)
    return {
        "comunicaciones_sin_ver": com["sin_ver"] if com else None,
        "comunicaciones_urgentes": com["urgentes"] if com else None,
        "comunicaciones_consultadas_el": com["consultado"] if com else None,
        "cuit": cuit, "nombre": c["nombre"], "actividad": c.get("actividad"), "categoria": categoria,
        "categoria_proyectada": proyectada, "sube_categoria": sube, "facturacion_periodo": fact,
        "origen_facturacion": c.get("origen_facturacion") if fact is not None else None, "tope": tope, "uso": uso,
        "margen": (tope - fact) if tope is not None and fact is not None else None,
        "deuda_arca": deuda, "saldo_ccma": saldo,
        "deuda_consultada_el": deuda_ccma["ultima_deuda"]["consultado_en"] if deuda_ccma else None,
        "periodos_deudores": sum(1 for x in deuda_ccma["saldos"] if x["estado"] == "deudor") if deuda_ccma else None,
        "sincronizado_el": sync, "sincronizacion_error": False, "desactualizado": viejo,
        "estado": estado, "motivo": motivo,
    }


@app.get("/api/demo/resumen/clientes")
def demo_resumen() -> dict[str, Any]:
    """Listado del Resumen armado sobre los clientes ficticios de Monotributo y CCMA."""
    mono, ccma, _ = _resumen_base()
    dfe_demo = json.loads(DFE_PATH.read_text(encoding="utf-8"))
    dfe: dict[str, dict[str, Any]] = {}
    for cl in dfe_demo["clientes"]:
        if not cl.get("ultima_consulta"):
            continue   # nunca consultado: queda sin dato, no en cero
        propias = [cm for cm in dfe_demo["comunicaciones"] if cm["cuit"] == cl["cuit"] and not cm.get("vista")]
        dfe[cl["cuit"]] = {"sin_ver": len(propias), "urgentes": sum(cm.get("urgencia") == "alta" for cm in propias),
                           "consultado": cl["ultima_consulta"]}
    filas = [_fila_resumen(c, ccma, mono["periodo"]["hasta"], dfe) for c in mono["contribuyentes"]]
    filas.sort(key=lambda f: (_ESTADO_ORDEN[f["estado"]], -(f["uso"] or 0), f["nombre"]))
    return {"periodo": mono["periodo"], "clientes": filas, "conteo": {"clientes": len(filas)}}


@app.get("/api/demo/resumen/clientes/{cuit}")
def demo_resumen_detalle(cuit: str) -> dict[str, Any]:
    mono, ccma, proy = _resumen_base()
    c = next((x for x in mono["contribuyentes"] if x["cuit"] == cuit), None)
    if c is None:
        raise HTTPException(status_code=404, detail="Ese CUIT no está en el seguimiento.")
    fila = _fila_resumen(c, ccma, mono["periodo"]["hasta"])
    meses = [{"mes": m["mes"], "facturacion": m["facturacion"], "compras": m["compras"] if c.get("compras") else None}
             for m in ((c.get("mensual") or {}).get("meses") or []) if not m["futuro"]]
    promedio = c.get("ingreso_promedio_mensual")
    limite = fila["tope"] / 12 if fila["tope"] else None
    cat = fila["categoria"]
    maxima = "K"
    categorias = [{
        "categoria": letra, "tope_anual": proy["categorias"][letra]["actual"], "limite_mensual": proy["categorias"][letra]["actual"] / 12,
        "tope_anual_proyectado": proy["categorias"][letra]["proyectado"], "limite_mensual_proyectado": proy["categorias"][letra]["proyectado"] / 12,
        "es_actual": letra == cat, "es_proyectada": letra == fila["categoria_proyectada"],
    } for letra in _ORDEN[: _ORDEN.index(maxima) + 1] if letra in proy["categorias"]]
    saldos = sorted(ccma[cuit]["saldos"], key=lambda s: s["periodo"], reverse=True)[:12] if cuit in ccma else []
    return {
        "cliente": {k: fila[k] for k in ("cuit", "nombre", "actividad", "categoria")},
        "estado": {k: fila[k] for k in ("estado", "motivo", "sincronizado_el", "desactualizado", "sincronizacion_error")},
        "periodo": mono["periodo"],
        "utilizacion": {k: fila[k] for k in ("facturacion_periodo", "origen_facturacion", "tope", "uso", "margen")},
        "deuda": {"monto": fila["deuda_arca"], "saldo_neto": fila["saldo_ccma"], "periodos_deudores": fila["periodos_deudores"],
                  "consultada_el": fila["deuda_consultada_el"], "saldos": saldos},
        "ventas": {"meses": meses, "limite_mensual": limite, "promedio_mensual": promedio,
                   "meses_promedio": c.get("meses_promedio"), "tiene_compras": bool(c.get("compras"))},
        "recategorizacion": {
            "categoria": cat, "categoria_proyectada": fila["categoria_proyectada"], "sube_categoria": fila["sube_categoria"],
            "recategorizacion": mono["periodo"].get("recategorizacion"), "promedio_mensual": promedio, "limite_actual": limite,
            "limite_proyectado": c.get("limite_mensual_proyectado"),
            "tope_anual": fila["tope"], "tope_anual_proyectado": proy["categorias"].get(cat, {}).get("proyectado"),
            "ipc": {"variacion_pct": proy["variacion_pct"], "estimativo": proy["estimativo"], "actualizacion": proy["actualizacion"]},
            "categorias": categorias,
        },
    }


@app.get("/api/demo/dfe")
def demo_dfe() -> dict[str, Any]:
    """Comunicaciones del domicilio fiscal de clientes ficticios, ya clasificadas."""
    return json.loads(DFE_PATH.read_text(encoding="utf-8"))


@app.get("/api/demo/ccma")
def demo_ccma() -> dict[str, Any]:
    """Cuenta corriente de Monotributistas y Autónomos de clientes ficticios."""
    return json.loads(CCMA_PATH.read_text(encoding="utf-8"))


# ------------------------------------------------------------------ Central de Notificaciones (demo)
# Solo entrega los avisos iniciales. Visto/Resuelto se guardan en el navegador de cada visitante (sessionStorage):
# la demo es pública, así que no puede haber estado compartido en el servidor.
NOTIF_SERVICIOS = {"dfe": "Domicilio Electrónico", "ccma": "CCMA", "monotributo": "Monotributo"}
NOTIF_TITULOS_MONOTRIBUTO = {
    "excede_tope": "Supera el tope de la categoría",
    "cerca_del_tope": "Cerca del tope de la categoría",
    "cambio_categoria": "Cambió la categoría en el padrón",
    "sincronizacion_fallida": "Falló la sincronización de Mis Comprobantes",
    "sincronizacion_antigua": "Datos de Mis Comprobantes desactualizados",
    "sin_escala": "Falta la escala aprobada",
    "sin_categoria": "No se identificó la categoría",
    "excede_parametro": "Supera un parámetro de la categoría",
    "compras_sobre_ventas": "Compras y gastos altos sobre la facturación",
}


def _aviso(servicio: str, cuit: str, hecho: str, titulo: str, detalle: str, fecha: Optional[str], severidad: Optional[str],
           nombre: str, detectado: str) -> dict[str, Any]:
    clave = f"{servicio}:{cuit}:{hecho}"
    return {
        "id": hashlib.sha1(clave.encode("utf-8")).hexdigest()[:12], "clave": clave, "servicio": servicio, "cuit": cuit,
        "nombre": nombre, "titulo": titulo, "detalle": detalle, "fecha_hecho": fecha, "severidad": severidad,
        "origen": servicio, "estado": "nuevo", "detectado_el": detectado, "resuelto_el": None, "resuelto_por": None,
        "en_origen": True,
    }


def _plata(monto: float) -> str:
    return f"$ {monto:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


@app.get("/api/demo/notificaciones")
def demo_notificaciones() -> dict[str, Any]:
    """Avisos iniciales de la Central, armados con los datos ficticios de Domicilio fiscal, CCMA y Monotributo."""
    dfe = json.loads(DFE_PATH.read_text(encoding="utf-8"))
    ccma = json.loads(CCMA_PATH.read_text(encoding="utf-8"))
    mono = json.loads(MONOTRIBUTO_PATH.read_text(encoding="utf-8"))
    detectado = f"{dfe['fecha_muestra']}T08:00:00"
    nombres = {c["cuit"]: c["nombre"] for c in dfe["clientes"]}
    avisos: list[dict[str, Any]] = []
    for c in dfe["comunicaciones"]:
        if c["vista"] or "no le" not in str(c.get("estado_arca", "")).lower():
            continue
        partes = [c.get("organismo"), f"fecha límite {c['fecha_limite']}" if c.get("fecha_limite") else None]
        sev = c.get("urgencia") if c.get("urgencia") in ("alta", "media", "baja") else "alta"
        avisos.append(_aviso("dfe", c["cuit"], c["id"], c["asunto"], " · ".join(p for p in partes if p), c.get("publicada"), sev,
                             nombres.get(c["cuit"], ""), detectado))
    for cl in dfe["clientes"]:
        if cl.get("error"):
            avisos.append(_aviso("dfe", cl["cuit"], "error", "No se pudo consultar el Domicilio fiscal", cl["error"]["mensaje"],
                                 dfe["fecha_muestra"], "alta", cl["nombre"], detectado))
    for cl in ccma["clientes"]:
        saldo = cl["ultima_deuda"]["saldo_neto"]
        if saldo is None or saldo >= 0:
            continue
        n = sum(1 for x in cl["saldos"] if x["estado"] == "deudor")
        detalle = f"Debe {_plata(-saldo)}" + (f" en {n} período{'s' if n != 1 else ''}" if n else "")
        avisos.append(_aviso("ccma", cl["cuit"], "deuda", "Deuda en ARCA", detalle, cl["ultima_deuda"]["consultado_en"][:10], None,
                             cl["nombre"], detectado))
    repetidos: dict[str, int] = {}
    for a in mono["alertas"]:
        if a.get("nivel") == "info":
            continue
        base = f"{a['cuit']}:{a['tipo']}"
        repetidos[base] = repetidos.get(base, 0) + 1
        hecho = a["tipo"] if repetidos[base] == 1 else f"{a['tipo']}#{repetidos[base]}"
        avisos.append(_aviso("monotributo", a["cuit"], hecho, NOTIF_TITULOS_MONOTRIBUTO.get(a["tipo"], "Aviso de Monotributo"),
                             a["mensaje"], None, None, a["nombre"], detectado))
    return {"avisos": avisos, "servicios": NOTIF_SERVICIOS, "ultima_actualizacion": detectado}


@app.get("/api/demo/granos")
def demo_granos() -> dict[str, Any]:
    """Liquidaciones primarias de granos ficticias, con el detalle completo que trae ARCA."""
    return json.loads(GRANOS_PATH.read_text(encoding="utf-8"))


DEMO_VENDEDOR = "VENDEDOR DE MUESTRA S.R.L."
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _granos_rango(desde: Optional[date], hasta: Optional[date]) -> list[dict[str, Any]]:
    """Liquidaciones ficticias del rango (inclusivo), en orden cronológico."""
    items = json.loads(GRANOS_PATH.read_text(encoding="utf-8"))["liquidaciones"]
    d, h = (desde.isoformat() if desde else ""), (hasta.isoformat() if hasta else "")
    visibles = [f for f in items if (not d or f["fecha_liquidacion"][:10] >= d) and (not h or f["fecha_liquidacion"][:10] <= h)]
    return sorted(visibles, key=lambda f: (f["fecha_liquidacion"], f["coe"]))


def _crudo_granos(f: dict[str, Any]) -> tuple[str, str]:
    """La demo guarda el detalle recortado y los totales aparte: se rearma la forma que devuelve ARCA."""
    det = f.get("detalle") or {}
    liq = {**(det.get("liquidacion") or {}), "codGrano": f["cod_grano"]}
    auth = {
        **(det.get("autorizacion") or {}), "coe": f["coe"], "ptoEmision": f.get("pto_emision"), "nroOrden": f.get("nro_orden"),
        "fechaLiquidacion": f["fecha_liquidacion"], "totalPesoNeto": f.get("peso_neto"), "subTotal": f.get("sub_total"),
        "importeIva": f.get("importe_iva"), "operacionConIva": f.get("operacion_con_iva"),
        "totalDeduccion": f.get("total_deduccion"), "totalNetoAPagar": f.get("total_neto_a_pagar"),
        "totalIvaRg4310_18": f.get("total_iva_rg4310_18"), "totalPagoSegunCondicion": f.get("total_pago_segun_condicion"),
    }
    return f["coe"], json.dumps({"liquidacion": liq, "autorizacion": auth})


def _filas_bd_demo(desde: Optional[date], hasta: Optional[date]):
    crudos = [_crudo_granos(f) for f in _granos_rango(desde, hasta)]
    return granos_plantilla.filas_desde_crudos(crudos, DEMO_VENDEDOR)


@app.get("/api/demo/granos/bd-liquidaciones")
def demo_granos_bd(desde: Optional[date] = None, hasta: Optional[date] = None) -> dict[str, Any]:
    """Plantilla «BD Liquidaciones» como texto tabulado (41 columnas), lista para pegar desde la columna A."""
    filas, avisos = _filas_bd_demo(desde, hasta)
    return {"filas": len(filas), "texto": granos_plantilla.a_tsv(filas), "avisos": avisos}


@app.get("/api/demo/granos/bd-liquidaciones.xlsx")
def demo_granos_bd_xlsx(desde: Optional[date] = None, hasta: Optional[date] = None) -> Response:
    filas, _ = _filas_bd_demo(desde, hasta)
    return Response(granos_plantilla.a_xlsx(filas), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="bd_liquidaciones_demo.xlsx"'})


@app.get("/api/demo/granos/liquidaciones.xlsx")
def demo_granos_listado_xlsx(desde: Optional[date] = None, hasta: Optional[date] = None) -> Response:
    """Plantilla «Listado simple»."""
    libro = Workbook(); ws = libro.active; ws.title = "Liquidaciones"
    campos = [("fecha_liquidacion", "Fecha"), ("coe", "COE"), ("pto_emision", "Pto. emisión"), ("nro_orden", "Nro. orden"),
              ("cuit_comprador", "CUIT comprador"), ("cod_grano", "Grano"), ("campania", "Campaña"),
              ("peso_neto", "Peso neto (kg)"), ("sub_total", "Subtotal"), ("importe_iva", "IVA"),
              ("operacion_con_iva", "Operación con IVA"), ("total_deduccion", "Deducciones"), ("total_neto_a_pagar", "Neto a pagar")]
    ws.append([etiqueta for _, etiqueta in campos])
    for f in _granos_rango(desde, hasta):
        ws.append([f.get(clave) for clave, _ in campos])
    salida = BytesIO(); libro.save(salida)
    return Response(salida.getvalue(), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="liquidaciones_demo.xlsx"'})


@app.get("/api/demo/emitir")
def demo_emitir() -> dict[str, Any]:
    """Plantillas y emisor ficticios para la emisión simulada (no hay estado ni envío a ARCA)."""
    return json.loads(EMITIR_PATH.read_text(encoding="utf-8"))


@app.get("/api/demo/invoices")
def demo_invoices(
    from_date: date,
    to_date: date,
    types: list[int] = Query(default=[11, 12, 13]),
    emisor: Optional[str] = None,
) -> dict[str, Any]:
    invoices = _filtered_invoices(from_date, to_date, types, emisor)
    return {
        "mode": "demo",
        "emisor": _emisor(emisor)["id"],
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "count": len(invoices),
        "invoices": invoices,
    }


def _export_response(invoices: list[dict[str, Any]], from_date: date, to_date: date) -> list[list[str]]:
    rows = []
    for invoice in invoices:
        rows.append([
            json.dumps(invoice.get(key), ensure_ascii=False)
            if key == "CbtesAsoc"
            else str(invoice.get(key, ""))
            for _, key in EXPORT_FIELDS
        ])
    return rows


@app.get("/api/demo/export.csv")
def export_demo_csv(
    from_date: date,
    to_date: date,
    types: list[int] = Query(default=[11, 12, 13]),
    emisor: Optional[str] = None,
) -> Response:
    invoices = _filtered_invoices(from_date, to_date, types, emisor)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([label for label, _ in EXPORT_FIELDS])
    writer.writerows(_export_response(invoices, from_date, to_date))
    filename = f"demo_comprobantes_{_emisor(emisor)['id']}_{from_date}_{to_date}.csv"
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/demo/export.xlsx")
def export_demo_xlsx(
    from_date: date,
    to_date: date,
    types: list[int] = Query(default=[11, 12, 13]),
    emisor: Optional[str] = None,
) -> Response:
    invoices = _filtered_invoices(from_date, to_date, types, emisor)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Demo"
    sheet.append([label for label, _ in EXPORT_FIELDS])
    for row in _export_response(invoices, from_date, to_date):
        sheet.append(row)
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for column in sheet.columns:
        width = min(max(len(str(cell.value or "")) for cell in column) + 2, 36)
        sheet.column_dimensions[column[0].column_letter].width = width
    output = BytesIO()
    workbook.save(output)
    filename = f"demo_comprobantes_{_emisor(emisor)['id']}_{from_date}_{to_date}.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
