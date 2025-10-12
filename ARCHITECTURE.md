# Zitly Architecture Diagram

## System Overview

This document visualizes the architecture and data flow of the Zitly URL shortening and routing service.

**Key Features:**

- Geographic-based link routing
- Real-time click tracking via WebSocket
- Automated destination health monitoring
- AI-powered link evaluation
- Multi-environment deployment support

**Recent Updates:**

- ✨ **Real-Time Click Tracking**: WebSocket integration for live geographic click visualization (Oct 2025)
- 🚀 **Staging Environment**: Multi-environment deployment configuration with dedicated staging setup
- 🔗 **Remote Bindings**: Development environment now uses remote Browser API and Workers AI for testing
- 📊 **Link Click Tracker DO**: New Durable Object for real-time geo-location aggregation with SQL storage
- 🔄 **Dual-Path Processing**: Immediate real-time updates alongside persistent queue-based storage

## Architecture Diagram

```mermaid
graph TB
    subgraph "External Users/Clients"
        EndUser[End User<br/>Clicking Links]
        DashboardUser[Dashboard User<br/>Managing Links]
    end

    subgraph "User Application Service<br/>(Cloudflare Worker)"
        Frontend[React Frontend<br/>Vite + TanStack Router]
        TrpcBackend[tRPC Backend Worker<br/>API Layer]

        Frontend -->|API Calls| TrpcBackend

        subgraph "tRPC Routers"
            LinksRouter[Links Router<br/>CRUD Operations]
            EvalRouter[Evaluations Router<br/>Status Checks]
        end

        TrpcBackend --> LinksRouter
        TrpcBackend --> EvalRouter
    end

    subgraph "Data Service<br/>(Cloudflare Worker)"
        HonoApp[Hono App<br/>GET /:id]
        QueueConsumer[Queue Consumer<br/>Process Link Clicks]
        WebSocketEndpoint[WebSocket Endpoint<br/>/click-socket]

        subgraph "Durable Objects"
            EvalScheduler[Evaluation Scheduler<br/>24h Alarm for Evals]
            ClickTracker[Link Click Tracker<br/>Real-time Geo Tracking]
        end

        subgraph "Workflows"
            EvalWorkflow[Destination Evaluation<br/>Workflow]

            subgraph "Workflow Steps"
                BrowserRender[1. Browser Render<br/>Collect Page Data]
                AICheck[2. AI Status Check<br/>Page Health]
                SaveEval[3. Save Evaluation<br/>to Database]
                BackupR2[4. Backup HTML<br/>to R2 Storage]
            end

            EvalWorkflow --> BrowserRender
            BrowserRender --> AICheck
            AICheck --> SaveEval
            SaveEval --> BackupR2
        end
    end

    subgraph "Shared Package"
        DataOps[Data Ops Package<br/>@repo/data-ops]

        subgraph "Data Ops Components"
            Database[Drizzle ORM<br/>Database Layer]
            Queries[Queries<br/>Links & Evaluations]
            Schemas[Zod Schemas<br/>Validation]
        end

        DataOps --> Database
        DataOps --> Queries
        DataOps --> Schemas
    end

    subgraph "Cloudflare Services"
        D1[(D1 Database<br/>SQLite)]
        KV[(KV Store<br/>Link Cache)]
        Queue[(Queue<br/>Link Click Events)]
        R2[(R2 Storage<br/>HTML Backups)]
        Browser[Browser API<br/>Page Rendering]
        AI[Workers AI<br/>Status Detection]
    end

    %% External User Flows
    EndUser -->|GET /:id| HonoApp
    DashboardUser --> Frontend

    %% Data Service Flows
    HonoApp -->|1. Lookup Link| KV
    HonoApp -->|2. Fallback Query| D1
    HonoApp -->|3. Cache Result| KV
    HonoApp -->|4. Send Click Event| Queue
    HonoApp -->|5. Redirect| EndUser

    Queue -->|Process Batch| QueueConsumer
    QueueConsumer -->|Save Click Data| D1
    QueueConsumer -->|Track Real-time| ClickTracker
    QueueConsumer -->|Schedule Eval| EvalScheduler

    EvalScheduler -->|After 24h Alarm| EvalWorkflow
    BrowserRender --> Browser
    AICheck --> AI
    BackupR2 --> R2

    %% Real-time Click Tracking
    DashboardUser -->|WebSocket Connect| WebSocketEndpoint
    WebSocketEndpoint -->|Establish Connection| ClickTracker
    ClickTracker -->|Broadcast Clicks| DashboardUser

    %% User Application Flows
    LinksRouter -->|CRUD| D1
    EvalRouter -->|Query| D1

    %% Shared Package Usage
    TrpcBackend -.->|Uses| DataOps
    HonoApp -.->|Uses| DataOps
    QueueConsumer -.->|Uses| DataOps
    EvalWorkflow -.->|Uses| DataOps

    %% Styling
    classDef userNode fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef serviceNode fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef storageNode fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef workflowNode fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef packageNode fill:#fff9c4,stroke:#f57f17,stroke-width:2px

    class EndUser,DashboardUser userNode
    class HonoApp,QueueConsumer,Frontend,TrpcBackend,LinksRouter,EvalRouter serviceNode
    class D1,KV,Queue,R2,Browser,AI storageNode
    class EvalScheduler,EvalWorkflow,BrowserRender,AICheck,SaveEval,BackupR2 workflowNode
    class DataOps,Database,Queries,Schemas packageNode
```

## Data Flow Sequences

### 1. Link Click Flow

```mermaid
sequenceDiagram
    participant User
    participant HonoApp as Hono App<br/>(/:id endpoint)
    participant KV as KV Cache
    participant D1 as D1 Database
    participant Queue as Queue
    participant QueueConsumer as Queue Consumer
    participant EvalScheduler as Evaluation Scheduler

    User->>HonoApp: GET /:id
    HonoApp->>KV: Lookup link info
    alt Link in cache
        KV-->>HonoApp: Return cached link
    else Cache miss
        HonoApp->>D1: Query link from DB
        D1-->>HonoApp: Return link info
        HonoApp->>KV: Cache link (24h TTL)
    end

    HonoApp->>HonoApp: Determine destination<br/>based on country
    HonoApp->>Queue: Send click event
    HonoApp->>ClickTracker: Track geo click immediately<br/>(lat, long, country)
    HonoApp->>User: 302 Redirect to destination

    Queue->>QueueConsumer: Process batch
    QueueConsumer->>D1: Save click data
    QueueConsumer->>EvalScheduler: Schedule evaluation<br/>(DO alarm)
```

### 2. Destination Evaluation Flow

```mermaid
sequenceDiagram
    participant Scheduler as Evaluation Scheduler<br/>(Durable Object)
    participant Workflow as Evaluation Workflow
    participant Browser as Browser API
    participant AI as Workers AI
    participant D1 as D1 Database
    participant R2 as R2 Storage

    Note over Scheduler: 24 hours after first click
    Scheduler->>Scheduler: Alarm triggers
    Scheduler->>Workflow: Create workflow instance

    Workflow->>Browser: Step 1: Render destination page
    Browser-->>Workflow: HTML + Body Text

    Workflow->>AI: Step 2: Analyze page status
    AI-->>Workflow: Status + Reason<br/>(Working/Broken/Suspicious)

    Workflow->>D1: Step 3: Save evaluation
    D1-->>Workflow: Evaluation ID

    Workflow->>R2: Step 4: Backup HTML<br/>& body text
    R2-->>Workflow: Success
```

### 3. Real-Time Click Tracking Flow

```mermaid
sequenceDiagram
    participant User as Dashboard User
    participant Frontend as React Frontend
    participant ProxyEndpoint as User App<br/>WebSocket Proxy
    participant DataService as Data Service<br/>WebSocket Endpoint
    participant ClickTracker as Link Click Tracker<br/>(Durable Object)
    participant QueueConsumer as Queue Consumer

    User->>Frontend: Open dashboard
    Frontend->>ProxyEndpoint: WebSocket connect<br/>/click-socket
    ProxyEndpoint->>DataService: Proxy WebSocket<br/>(add account-id header)
    DataService->>ClickTracker: Upgrade to WebSocket
    ClickTracker-->>Frontend: WebSocket established

    Note over Frontend,ClickTracker: Real-time connection active

    QueueConsumer->>ClickTracker: addClick(lat, long, country)
    ClickTracker->>ClickTracker: Store in SQL storage<br/>Set 2s alarm

    Note over ClickTracker: After 2 seconds

    ClickTracker->>ClickTracker: Alarm triggers<br/>Query recent clicks
    ClickTracker->>Frontend: Broadcast geo clicks<br/>via WebSocket
    Frontend->>User: Update map visualization<br/>in real-time

    ClickTracker->>ClickTracker: Clean up old clicks<br/>Keep last 1000
```

### 4. Dashboard User Flow

```mermaid
sequenceDiagram
    participant User as Dashboard User
    participant Frontend as React Frontend
    participant tRPC as tRPC Backend
    participant D1 as D1 Database

    User->>Frontend: View links dashboard
    Frontend->>tRPC: links.linkList()
    tRPC->>D1: Query user's links
    D1-->>tRPC: Return links
    tRPC-->>Frontend: Links data
    Frontend-->>User: Display links table

    User->>Frontend: Create new link
    Frontend->>tRPC: links.createLink(data)
    tRPC->>D1: Insert link record
    D1-->>tRPC: Link ID
    tRPC-->>Frontend: Success
    Frontend-->>User: Show new link

    User->>Frontend: View link details
    Frontend->>tRPC: links.getLink(id)<br/>evaluations.list(linkId)
    tRPC->>D1: Query link & evaluations
    D1-->>tRPC: Link + evaluation history
    tRPC-->>Frontend: Combined data
    Frontend-->>User: Display link details<br/>& health status
```

## Component Details

### Data Service (apps/data-service)

- **Purpose**: Handles link redirects and destination monitoring
- **Technology**: Cloudflare Worker with Hono framework
- **Key Features**:
  - Geographic routing (country-based destinations)
  - Link click tracking via queues
  - Real-time click tracking via WebSocket
  - Automated destination health checks (24h intervals)
  - Browser rendering for page analysis
  - AI-powered status detection
- **Durable Objects**:
  - **Link Click Tracker**: Stores recent geo-location clicks in SQL storage, broadcasts to connected WebSocket clients every 2 seconds
  - **Evaluation Scheduler**: Manages 24-hour evaluation alarms for each link-destination pair

### User Application (apps/user-application)

- **Purpose**: Dashboard for managing links and viewing analytics
- **Technology**: React (Vite) + tRPC backend worker
- **Key Features**:
  - Link CRUD operations
  - Real-time analytics dashboard with WebSocket integration
  - Live geographic click visualization
  - Evaluation history viewer
  - Geographic click distribution
- **Real-Time Features**:
  - WebSocket proxy endpoint (`/click-socket`) that forwards connections to Data Service
  - Zustand store for managing real-time click state (max 1000 clicks)
  - Automatic reconnection with exponential backoff (max 5 retries)

### Data Ops Package (packages/data-ops)

- **Purpose**: Shared database layer and schemas
- **Technology**: Drizzle ORM + Zod
- **Provides**:
  - Database abstractions
  - Type-safe queries
  - Validation schemas
  - Reusable data operations

## Storage Architecture

### D1 Database

- Primary data store
- Stores: links, destinations, clicks, evaluations
- Shared between both services

### KV Store

- Link metadata cache (24h TTL)
- Reduces D1 queries for hot links
- Improves redirect latency

### R2 Storage

- Long-term storage for evaluation artifacts
- Organized by: `evaluations/{accountId}/{html|body-text}/{evaluationId}`

### Queue

- Asynchronous click processing
- Decouples redirect from analytics
- Named: `zitly-data-queue-stage`

### Durable Object SQL Storage

**Link Click Tracker** uses Durable Object SQL storage for:

- Temporary storage of recent geo-clicks (latitude, longitude, country, timestamp)
- Fast queries for real-time aggregation
- Automatic cleanup to maintain only relevant recent data
- Schema:
  ```sql
  CREATE TABLE geo_link_clicks (
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      country TEXT NOT NULL,
      time INTEGER NOT NULL
  )
  ```

## Deployment Architecture

### Environments

The application supports multiple deployment environments:

- **Development**: Local development with `wrangler dev --x-remote-bindings`
- **Staging**: Pre-production testing environment
- **Production**: Live production environment

### Deployment Scripts

Both services include staging deployment commands:

```bash
# Data Service
npm run stage:deploy  # wrangler deploy --env stage

# User Application
npm run stage:deploy  # npm run build && wrangler deploy
```

### Remote Bindings

Data Service development mode uses `--x-remote-bindings` flag to access:

- Browser API for page rendering
- Workers AI for status detection
- Remote D1 database
- Remote R2 storage

This ensures development environment matches production behavior.

## Key Design Patterns

1. **Service Bindings**: Both workers share the same D1 database
2. **Monorepo Structure**: Shared code via `@repo/data-ops` package
3. **Cache-Aside Pattern**: KV cache with D1 fallback
4. **Event-Driven**: Queue-based click processing
5. **Durable Objects**: Stateful scheduling and real-time tracking with alarms
6. **Workflows**: Multi-step orchestration for evaluations
7. **WebSocket Communication**: Real-time click tracking with automatic reconnection
8. **Edge Computing**: All services run on Cloudflare's edge network
9. **Dual-Path Click Processing**:
   - **Fast Path**: Immediate geo-click tracking to Click Tracker DO for real-time updates
   - **Slow Path**: Queued processing for persistent storage in D1 and evaluation scheduling
   - This ensures dashboard users see clicks instantly while maintaining data integrity

## Scaling Considerations

- **Geographic Distribution**: Workers deployed globally
- **Automatic Scaling**: Cloudflare handles traffic spikes
- **Durable Objects**:
  - Evaluation Scheduler: Unique per link-destination pair
  - Click Tracker: One per account for real-time aggregation
- **Queue Batching**: Processes clicks in batches
- **Workflow Retries**: Built-in retry logic for each step
- **Cache Layer**: Reduces database load for popular links
- **WebSocket Scaling**: Each Durable Object maintains WebSocket connections per account
- **Data Retention**: Click Tracker maintains only recent 1000 clicks in memory for real-time streaming
