"""Public-safe, read-only demo app backed only by synthetic fixture data."""

from __future__ import annotations

import csv
import json
from datetime import date
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook
from starlette.responses import FileResponse, Response

DEMO_DIR = Path(__file__).resolve().parent / "static" / "demo"
DATA_PATH = DEMO_DIR / "demo-data.json"
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


def _filtered_invoices(from_date: date, to_date: date, types: list[int]) -> list[dict[str, Any]]:
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="from_date must be on or before to_date.")
    if not types or any(code not in {11, 12, 13} for code in types):
        raise HTTPException(status_code=400, detail="types must be selected from 11, 12, and 13.")
    start = from_date.isoformat()
    end = to_date.isoformat()
    return [
        invoice
        for invoice in _dataset()["invoices"]
        if invoice["Fecha"] >= start
        and invoice["Fecha"] <= end
        and int(invoice["TipoComprobante"]) in types
    ]


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(DEMO_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "demo-read-only"}


@app.get("/api/demo/summary")
def demo_summary() -> dict[str, Any]:
    dataset = _dataset()
    invoices = dataset["invoices"]
    return {
        "mode": "demo",
        "issuer": dataset["issuer"],
        "count": len(invoices),
        "latest_issue_date": max((invoice["Fecha"] for invoice in invoices), default=None),
        "types": [11, 12, 13],
    }


@app.get("/api/demo/invoices")
def demo_invoices(
    from_date: date,
    to_date: date,
    types: list[int] = Query(default=[11, 12, 13]),
) -> dict[str, Any]:
    invoices = _filtered_invoices(from_date, to_date, types)
    return {
        "mode": "demo",
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
) -> Response:
    invoices = _filtered_invoices(from_date, to_date, types)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([label for label, _ in EXPORT_FIELDS])
    writer.writerows(_export_response(invoices, from_date, to_date))
    filename = f"demo_comprobantes_{from_date}_{to_date}.csv"
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
) -> Response:
    invoices = _filtered_invoices(from_date, to_date, types)
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
    filename = f"demo_comprobantes_{from_date}_{to_date}.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
