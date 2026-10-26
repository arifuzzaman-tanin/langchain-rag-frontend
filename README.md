# Papertrail frontend

A React + TypeScript interface for the PDF RAG backend. It supports:

- PDF upload, processing status, selection, and deletion
- Conversation creation, history, message loading, and deletion
- Grounded questions with document and page citations
- Backend readiness status

## Run locally

Start the backend at `http://localhost:8000`, then run:

```powershell
cd D:\frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/health` to the local backend, so local development does not require cross-origin configuration.

For another backend URL, copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL`. The backend must allow the frontend origin in its CORS configuration.

The chat endpoint requires a valid Gemini API key configured on the backend. Do not put API keys in this frontend project.

## Validate

```powershell
npm run lint
npm run build
```
