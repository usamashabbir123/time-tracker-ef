# Time Tracking Application

Complete production-ready Docker setup with Angular frontend, Node.js backend, and MySQL database.

## Architecture
- **Frontend**: Angular app served by Nginx on ports 4200 & 80
- **Backend**: Node.js Express API running on host port 3000
- **Database**: MySQL 5.7 in Docker on port 3306
- **Network**: Docker bridge network so containers can communicate

## Quick Start

### Step 1: Setup environment files
```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

### Step 2: Start the stack
```bash
# First time setup
docker compose down -v
docker compose up -d --build

# Subsequent starts
docker compose up -d
```

### Step 3: Access the application
- **Frontend (port 4200)**: http://localhost:4200
- **Frontend (port 80)**: http://localhost
- **Backend API**: http://localhost:3000/api
- **Health check**: curl http://localhost:3000/api/test

### Step 4: Login
```
Email: admin@example.com
Password: admin123
```

## How It Works

1. **Docker starts MySQL** on internal bridge network
2. **Frontend Docker container** (Nginx):
   - Serves Angular build on ports 80 & 4200
   - Sends API requests to `http://host.docker.internal:3000/api`
   - Handles SPA routing (all routes serve index.html)
3. **Backend (runs on host)**:
   - Listens on port 3000
   - Accepts requests from `host.docker.internal` via CORS
   - Connects to MySQL at `localhost:3306`
4. **Database initialization**:
   - Schema auto-created on first run
   - Admin user auto-seeded (`admin@example.com` / `admin123`)

## Viewing Logs
```bash
docker compose logs -f                # All services
docker compose logs -f frontend       # Frontend only
docker compose logs -f db             # Database only
```

## Environment Variables

### Frontend (injected at build time)
- `API_URL`: Backend URL (default: `http://host.docker.internal:3000`)

### Backend (backend/.env)
```
DB_HOST=db
DB_PORT=3306
DB_USER=tt_user
DB_PASSWORD=tt_password
DB_NAME=time_tracking
PORT=3000
JWT_SECRET=your_secret_key
NODE_ENV=production
```

## Troubleshooting

**Frontend can't reach backend:**
- Verify backend is running on host: `curl http://localhost:3000/api/test`
- Check `docker compose.yml` has `API_URL: "http://host.docker.internal:3000"`
- Verify CORS in `backend/server.js` allows `host.docker.internal`

**Database connection fails:**
- Check MySQL is running: `docker compose ps db`
- View DB logs: `docker compose logs db`
- Ensure credentials match between `docker-compose.yml` and `backend/.env`

**Port already in use:**
Edit `docker-compose.yml`:
```yaml
frontend:
  ports:
    - "8080:80"    # Change to 8080
    - "4200:80"    # Keep 4200
```

## File Structure
```
├── docker-compose.yml         # Compose config (MySQL + Frontend only)
├── nginx.conf                 # Nginx SPA routing + API proxy
├── Dockerfile.frontend        # Angular build → Nginx serve
├── .env.example              # Environment template
├── src/environments/
│   ├── environment.ts        # Dev (localhost:3000)
│   └── environment.prod.ts   # Prod (injected at build)
├── backend/
│   ├── .env.example         # Backend env template
│   ├── server.js            # Express with CORS config
│   └── database/
│       ├── init.sql         # Schema definition
│       └── init-db.js       # Init script
└── README.md
```

## Development

For local `ng serve` development:
```bash
# Start MySQL only
docker compose up -d db

# Start backend (on host)
cd backend
npm install
npm start

# Start frontend (in new terminal)
npm install
npm start
```

Then access at http://localhost:4200

## Production Deployment

1. Update `docker-compose.yml` `API_URL` with your backend domain
2. Use environment variables for secrets
3. Add HTTPS/reverse proxy (Nginx, HAProxy, AWS ALB)
4. Store JWT_SECRET securely (env var or secrets manager)

---

**Admin Login**: `admin@example.com` / `admin123`

