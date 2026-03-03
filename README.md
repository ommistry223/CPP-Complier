# Code Arena - Competitive Programming Platform

A scalable competitive programming platform built with Node.js microservices, PostgreSQL, Redis, and a React/Vite frontend. Designed for classroom tournaments and hackathons.

## Features

* **Tournament Mode** - Bulk-create N parallel 1v1 rooms, global leaderboard, admin start-contest with 30s countdown
* **No Points System** - Winner = most questions solved; ties broken by grid cell count (pure performance ranking)
* **Knife System** - 3 knives given at game start; usable in Battle Phase (Q4+) to cut an opponent grid cell
* **Tic-Tac-Toe Grid** - Solve questions to claim cells; first tic-tac-toe wins instantly
* **Leaderboard** - Shows solved count per team; admin view shows per-question tick grid
* **Monaco Editor** - Syntax-highlighted C/C++ editor with dark theme and IntelliSense
* **Run/Submit Animations** - Shimmer sweep on buttons during compilation; knife mode highlights the grid
* **Hints** - Admin adds per-problem hints revealed by teams during play
* **Horizontal Scaling** - Nginx load balancer, 3 Bull/Redis workers, PgBouncer connection pooler

## Prerequisites - Docker Desktop only

You only need one thing installed:

* [Docker Desktop](https://www.docker.com/products/docker-desktop) (Windows/Mac/Linux)

No Node.js, PostgreSQL, or Redis installation required on your machine.
Everything runs inside Docker containers.

---

## Quick Start

### First time on any machine

1. Install **Docker Desktop** and make sure it is running (whale icon in system tray).
2. Double-click **``setup.bat``** - builds all images and initialises the database (run once only).
3. Double-click **``run.bat``** - starts all services in the background.
4. Open **http://localhost:8080** in your browser.
5. Open **http://localhost:8080/admin_panel** for the admin panel.

### Starting after setup

Just double-click **``run.bat``** every time you want to start Code Arena.

### Stopping

Double-click **``stop-app.bat``** or run ``docker compose down`` in a terminal.

To wipe all data (rooms, problems): ``docker compose down -v``

---

## URLs

| Service | URL |
|---------|-----|
| Platform | http://localhost:8080 |
| Admin Panel | http://localhost:8080/admin_panel |
| pgAdmin (DB UI) | http://localhost:5050 (admin@codearena.dev / admin123) |

---

## Bat File Reference

| File | Purpose |
|------|---------|
| ``setup.bat`` | First-time: builds images, runs migrations and seeds problems |
| ``run.bat`` | Start all containers (docker compose up -d) |
| ``stop-app.bat`` | Stop all containers (docker compose down) |

---

## Architecture Overview

```
nginx (load balancer :8080)
  +-- api1 (Node.js / Express / WebSocket / GameManager)
  +-- api2 (Node.js / Express — compiler + problems routes only)
  +-- frontend (React/Vite, served by nginx)
  +-- pgbouncer (PostgreSQL connection pooler)
        +-- db (PostgreSQL 15)
redis   (Bull queue + in-memory room state + verdict cache)
worker x3 (Bull job processors — compiler + submit queues)
pgadmin :5050 (DB admin UI)
```

## Game Flow

1. Admin creates a room (or bulk-creates a tournament of N rooms).
2. Teams join with their team codes on the Lobby page.
3. Admin starts the game (30-second countdown for tournaments).
4. Teams solve coding questions - first to solve picks a tic-tac-toe grid cell.
5. Questions 1-3: **Knife Phase** - grid pick only, no knives yet.
6. Questions 4+: **Battle Phase** - teams can use up to 3 knives to destroy opponent cells.
7. Game ends when all questions are answered or a team gets tic-tac-toe.
8. Winner = most questions solved. Ties broken by grid cell count.