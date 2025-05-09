# OpsPilot Enterprise Backend

This is the backend service for OpsPilot Enterprise, providing API endpoints for operations management.

## Project Structure

```
ops-pilot-enterprise-backend/
├── src/
│   ├── auth/       # Authentication and authorization
│   ├── orgs/       # Organizations management
│   ├── users/      # User logic and RBAC
│   ├── projects/   # Project and workflow modules
│   ├── tasks/      # Tasks and dependencies
│   ├── timelogs/   # Internal time tracking
│   ├── etl/        # CSV import and normalization
│   ├── kpi/        # KPI and leaderboard APIs
│   ├── audit/      # Audit logs
│   ├── exports/    # CSV/JSON report downloads
│   ├── jobs/       # Background cron jobs
│   ├── utils/      # Shared helpers
│   └── main.ts     # Encore.ts bootstrap
├── prisma/
│   ├── schema.prisma  # Prisma schema
│   └── seed.ts        # Sample data seed script
├── .env            # DB + Auth config
├── .gitignore
├── README.md
├── package.json
├── tsconfig.json
└── docker-compose.yml  # Optional: for DB container
```

## Prerequisites

- Node.js (v16+)
- PostgreSQL
- npm or yarn

## Setup

1. Clone the repository:
```bash
git clone https://github.com/your-org/ops-pilot-enterprise-backend.git
cd ops-pilot-enterprise-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up the environment variables by copying the example:
```bash
cp .env.example .env
```
Then edit the `.env` file with your database credentials.

4. Generate Prisma client:
```bash
npm run prisma:generate
```

5. Run database migrations:
```bash
npm run prisma:migrate
```

6. Seed the database with initial data:
```bash
npm run prisma:seed
```

## Development

Start the development server:
```bash
npm run dev
```

## Build and Production

Build the project:
```bash
npm run build
```

Start in production mode:
```bash
npm start
```

## API Documentation

API documentation is available at `/api-docs` when the server is running.
