# Saaphzone OCEMS

Online Continuous Emission & Effluent Monitoring System (OCEMS) platform designed for real-time industrial monitoring, CPCB/SPCB compliance, and data analytics.

## Project Structure

```
├── backend/          # Node.js / Express backend with WebSocket & MongoDB integration
├── frontend/         # React dashboard with real-time charts, maps, and reports
└── README.md
```

## Getting Started

### 1. Backend Setup

```bash
cd backend
npm install
cp .env.example .env    # Configure your environment variables
npm start               # Runs server on configured port (default 4000)
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm start               # Runs React app at http://localhost:3000
```
