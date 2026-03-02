# 🚀 Docker Commands Guide

This guide contains everything you need to know about running and maintaining the **CodeRunner** platform using Docker.

---

## 🏗️ 1. First Time Setup

Wait, ensure your **Docker Desktop** is running before starting.

### Step 1: Build and Launch Containers
This will download base images, build your backend/frontend, and start everything in the background.
```powershell
docker-compose up --build -d
```

### Step 2: Initialize Database and Data
Once the containers are running, you **MUST** run the migrations and seed data *inside* the API container.
```powershell
# Run the migration script inside the first api container
docker-compose exec api1 npm run migrate

# Add pre-made problems and test cases to the database
docker-compose exec api1 npm run seed
```

---

## 🛠️ 2. Common Maintenance Commands

### ✅ View Running Services
```powershell
docker-compose ps
```

### 📋 View Live Logs
```powershell
# Follow all container logs
docker-compose logs -f

# Follow logs for specific services (e.g., API or Workers)
docker-compose logs -f api1 worker1
```

### 🔄 Rebuild & Restart One Service
If you made changes to the `backend` and only want to rebuild the API:
```powershell
docker-compose up --build -d api1
```

---

## 🧹 3. Cleanup & Stopping

### ⏹️ Stop Containers (keep data)
```powershell
docker-compose stop
```

### 🛑 Shutdown Everything (volumes stay intact)
```powershell
docker-compose down
```

### 🗑️ Full Reset (Wipe Database & Volumes)
**⚠️ WARNING:** This will delete all your local database data!
```powershell
docker-compose down -v
```

---

## 🌐 4. How to Access

- **Frontend:** [http://localhost](http://localhost) (mapped via Nginx)
- **API Entrypoint:** [http://localhost/api/](http://localhost/api/)
- **Individual APIs (Direct):** Port `5001` and `5002`
- **Database (Postgres):** Port `5432`

---

## 📝 Tips for Windows Users
- Use **PowerShell** or **Command Prompt** in the project root folder.
- If you see `docker-compose: command not found`, make sure **Docker Desktop** is installed and added to your PATH.
- If the frontend doesn't load immediately, wait roughly 30s-1min for the build process (first time only) to complete.
