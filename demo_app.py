"""Public-safe, read-only demo app backed only by synthetic fixture data."""

from __future__ import annotations

import csv
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


@app.get("/api/demo/dfe")
def demo_dfe() -> dict[str, Any]:
    """Comunicaciones del domicilio fiscal de clientes ficticios, ya clasificadas."""
    return json.loads(DFE_PATH.read_text(encoding="utf-8"))


@app.get("/api/demo/ccma")
def demo_ccma() -> dict[str, Any]:
    """Cuenta corriente de Monotributistas y Autónomos de clientes ficticios."""
    return json.loads(CCMA_PATH.read_text(encoding="utf-8"))


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
