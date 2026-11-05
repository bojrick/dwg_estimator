# Plan Vault PWA (DWG / CAD Estimator & Viewer)

A web-based CAD / DWG drawing viewer, sheet organizer, and estimation suite powered by FastAPI and React (Vite + Tailwind CSS).

---

## Architecture Overview

- **Backend**: FastAPI (Python 3.10+ / Python 3.14 compatible), SQLModel, SQLite / PostgreSQL (Supabase), Cloudflare R2 / local disk fallback storage, `ezdxf` for DXF parsing and rendering.
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS v4, Lucide icons.

---

## Prerequisites

- **Python**: 3.10 or newer (`python3 --version`)
- **Node.js**: 18+ or 20+ (`node -v`) & npm (`npm -v`)
- *(Optional)* Docker & Docker Compose if containerizing.

---

## Installation & Setup

### 1. Backend Setup

1. Open the backend directory and set up a virtual environment:
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

3. Configure environment variables:
   Copy `.env.example` to `.env` (or configure existing `.env`):
   ```bash
   cp .env.example .env
   ```
   *By default, if `DATABASE_URL` is empty, the backend falls back to local SQLite database (`backend/app.db`). If Cloudflare R2 keys are omitted or invalid, it falls back to local storage in `backend/local_storage`.*

4. Run the FastAPI backend:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   The backend API will be available at [http://localhost:8000](http://localhost:8000). Interactive Swagger documentation is available at [http://localhost:8000/docs](http://localhost:8000/docs).

---

### 2. Frontend Setup

1. Open the frontend directory:
   ```bash
   cd ../frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the Vite development server:
   ```bash
   npm run dev
   ```
   The frontend application will be served at [http://localhost:5173](http://localhost:5173).

4. To produce a production build:
   ```bash
   npm run build
   ```

---

## Verification & Health Check

- **Swagger UI**: Visit `http://localhost:8000/docs`
- **Plans API**: `curl http://127.0.0.1:8000/api/plans`
- **Frontend Interface**: Visit `http://localhost:5173`

