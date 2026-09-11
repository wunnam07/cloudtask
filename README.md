# CloudTask

CloudTask is a cloud-hosted task management REST API built with Node.js and deployed on Microsoft Azure.

The project demonstrates cloud application deployment, passwordless authentication, private networking, Azure SQL, Blob Storage, monitoring, cost governance, and automated CI/CD with GitHub Actions.

## Architecture

Client
  |
  v
Azure App Service
  |
  +-- Azure SQL Database
  |     Authentication: Managed Identity / Microsoft Entra ID
  |
  +-- Azure Blob Storage
        Authentication: Managed Identity
        Downloads: User Delegation SAS

Supporting Azure services:

- Azure Virtual Network
- Private Endpoints
- Private DNS Zones
- Network Security Groups
- Log Analytics
- Azure Monitor Alerts
- Azure Cost Management Budget
- GitHub Actions

## Application

The API supports:

- Creating tasks
- Listing tasks
- Retrieving individual tasks
- Updating tasks
- Deleting tasks
- Uploading task attachments
- Listing attachments
- Generating temporary read-only SAS download URLs
- Application health checks

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check application health |
| GET | `/api/tasks` | List tasks |
| GET | `/api/tasks/:id` | Retrieve one task |
| POST | `/api/tasks` | Create a task |
| PUT | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task |
| POST | `/api/tasks/:id/attachments` | Upload an attachment |
| GET | `/api/tasks/:id/attachments` | List attachments and generate SAS URLs |

## Azure Services

### Azure App Service

Hosts the Node.js application using Node.js 24 LTS.

### Azure SQL Database

Stores task and attachment metadata.

The application authenticates to SQL using its system-assigned Managed Identity rather than storing a SQL password in application settings.

### Azure Blob Storage

Stores uploaded task attachments.

The App Service accesses Blob Storage using Managed Identity and generates read-only User Delegation SAS URLs for temporary file access.

### Networking

The application uses:

- VNet Integration for App Service
- Private Endpoint for Azure SQL
- Private Endpoint for Blob Storage
- Private DNS Zones
- Network Security Groups

Public access to protected data services can therefore be restricted while the application accesses them through Azure networking.

## Security

CloudTask uses:

- Microsoft Entra ID
- System-assigned Managed Identity
- Azure RBAC
- Passwordless application-to-database authentication
- Private Endpoints
- Read-only User Delegation SAS tokens
- GitHub encrypted repository secrets

No SQL administrator password is stored in the application source code.

## CI/CD

The project uses GitHub Actions.

Every push to the `main` branch triggers:

1. Repository checkout
2. Node.js setup
3. Dependency installation
4. Tests when available
5. Deployment to Azure App Service

Workflow:

`.github/workflows/deploy.yml`

## Monitoring and Governance

The Azure environment includes:

- Log Analytics workspace
- App Service diagnostic settings
- HTTP 5xx Azure Monitor alert
- Email Action Group
- Monthly Azure Cost Management budget
- 50% and 80% budget notifications
- Resource tagging

Project tags:

- `Project=CloudTask`
- `Environment=Production`
- `Owner=Wunnam`

## Environment Variables

The application expects:

- `AZURE_SQL_SERVER`
- `AZURE_SQL_DATABASE`
- `STORAGE_ACCOUNT_NAME`

Sensitive application credentials are not stored in the repository.

## Deployment

Production API:

`https://cloudtask-1789145135.azurewebsites.net`

Health endpoint:

`https://cloudtask-1789145135.azurewebsites.net/api/health`

## Verification

The deployed application has been tested for:

- Azure SQL connectivity
- Task creation
- Task retrieval
- Task updates
- Task deletion
- Blob attachment uploads
- SAS URL generation
- Managed Identity authentication
- GitHub Actions automatic deployment
- Application health monitoring

## Author

Wunnam
