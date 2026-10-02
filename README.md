# ARCA Billing Demo

Portfolio demonstration of an invoice-history UI using synthetic data only.

**This is not connected to ARCA and cannot issue invoices or request CAEs.**
Every recipient, amount, comprobante, and `DEMO-CAE-*` value is fictional.

## Run locally

```bash
cd portfolio-demo
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn demo_app:app --host 127.0.0.1 --port 8002
```

Open http://127.0.0.1:8002/.

## Deploy to Render with HTTPS

1. Create a new **public GitHub repository** using the contents of this folder
   only. Do not publish the parent project repository.
2. In Render, create a Blueprint from that GitHub repository and use the
   included `render.yaml`.
3. Wait for the deployment and open the HTTPS URL assigned by Render.
4. Confirm `/health`, the demo UI, filters, and CSV/XLSX downloads work.
5. Confirm no ARCA environment variables, certificates, or private data were
   added in Render settings or repository files.

The container build includes only `demo_app.py` and `static/demo/`. It has no
ARCA credentials, `.env`, production API, SQLite database, or write endpoint.
No persistent disk is required because the sample data is a static JSON fixture.
