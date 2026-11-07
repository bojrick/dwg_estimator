module.exports = {
  apps: [
    {
      name: "dwg-backend",
      cwd: "./backend",
      script: ".venv/bin/uvicorn",
      args: "app.main:app --host 127.0.0.1 --port 8000 --reload",
      interpreter: "none",
      env: {
        PYTHONUNBUFFERED: "1"
      }
    },
    {
      name: "dwg-frontend",
      cwd: "./frontend",
      script: "npm",
      args: "run dev",
      env: {
        NODE_ENV: "development"
      }
    }
  ]
};

