# ARCA Billing Demo

Portfolio demonstration of an invoice-history UI using synthetic data only.

**This is not connected to ARCA and cannot issue invoices or request CAEs.**
Every recipient, amount, comprobante, and `DEMO-CAE-*` value is fictional.

## Sections

- **Comprobantes**: invoice history with filters and CSV/Excel export.
- **Monotributo**: billing for the recategorization period against the category cap,
  with alerts. Taxpayers, amounts, and the period date are synthetic and fixed.

## Run locally

```bash
cd portfolio-demo
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn demo_app:app --host 127.0.0.1 --port 8002
```

Open http://127.0.0.1:8002/.

## Live demo

The demo is deployed on Render with HTTPS:

**https://arca-billing-portfolio-demo.onrender.com/**

It is served by the Blueprint in this repository. The free instance may sleep
after inactivity; the first request after that can take around 50 seconds.

## Deployment maintenance

The Render service uses the Dockerfile and `render.yaml` in this repository.
Keep this repository limited to the demo package. Do not add the parent project,
ARCA credentials, `.env`, certificates, or production data.

The container build includes only `demo_app.py` and `static/demo/`. It has no
ARCA credentials, `.env`, production API, SQLite database, or write endpoint.
No persistent disk is required because the sample data is a static JSON fixture.
