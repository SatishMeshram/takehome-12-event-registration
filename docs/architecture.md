# Architecture
## 1. System Overview
The Event Registration application is a full-stack web application for managing events, sessions, attendee registrations, check-in staff assignments, registration lifecycle, capacity, alerts, and operational reporting.
The system follows a simple three-layer architecture:
User
↓
React Frontend
↓
Express REST API
↓
Prisma ORM
↓
MySQL Database
The architecture was intentionally kept simple and maintainable for the assignment time budget while keeping authorization and business rules on the server.
## 2. Technology Stack
### Frontend
- React
- Vite
- JavaScript
- CSS
### Backend
- Node.js
- Express
- JWT authentication
- bcrypt password hashing
- Multer for CSV file uploads
### Database
- MySQL
- Prisma ORM
- Prisma Client
- Prisma MariaDB adapter
### Development
- Git
- GitHub
- MySQL Workbench
- PowerShell
- REST API testing
## 3. Frontend Architecture
The React application is implemented primarily through:
- `client/src/App.jsx` — application UI, navigation, API interactions, forms, tables and role-specific workflows.
- `client/src/App.css` — application styling and responsive presentation.
- `client/src/main.jsx` — React application entry point.
The frontend communicates with the Express API using HTTP requests.
The UI provides different workflows based on the authenticated user's role:
### Organizer
- Dashboard
- Event management
- Session management
- Registration management
- CSV import/export
- Staff assignment
- Capacity alerts
- Registration history
### Check-in Staff
- Assigned session list
- Attendee registration visibility
- Authorized attendee check-in
Frontend visibility improves UX, but security does not depend on frontend restrictions. Authorization is enforced by the backend.
## 4. Backend Architecture
The backend is implemented in `server.js` using Express.
Major backend responsibilities include:
- Authentication
- JWT verification
- Role-based authorization
- Request validation
- Event and session management
- Registration lifecycle management
- Reservation expiry
- Staff assignment
- CSV import/export
- Dashboard aggregation
- Capacity alert synchronization
- Immutable registration history
The backend retrieves the current user from the database after JWT verification. This ensures authorization uses the current database role rather than trusting a client-provided role.
## 5. Authentication Flow
Authentication follows this flow:
1. User submits email and password.
2. Server validates the credentials.
3. Password is checked using bcrypt.
4. A JWT is generated after successful authentication.
5. The frontend stores the authentication token for subsequent API requests.
6. Protected API requests include the token.
7. The backend verifies the JWT.
8. The backend retrieves the current user from MySQL.
9. The authenticated user is attached to the request.
10. Role middleware enforces authorization.
Passwords are never stored in plaintext.
## 6. Authorization
The application has two roles:
- `ORGANIZER`
- `CHECKIN_STAFF`
Authorization is enforced server-side using role middleware.
Examples:
### Organizer-only operations
- Create/edit/archive/restore events
- Create/edit/delete sessions
- Manage registrations
- Import registrations
- Manage staff assignments
- View dashboard
- Manage capacity alerts
### Check-in staff operations
- View assigned sessions
- Check in attendees from assigned sessions
A check-in staff member cannot check in an attendee from a session to which they are not assigned.
Public registration only permits creation of `CHECKIN_STAFF` accounts. Organizer accounts are not allowed through the public registration endpoint.
## 7. Event and Session Data Flow
Organizer creates an event through the React frontend.
The frontend sends:
POST /api/events
The Express API validates the request and persists the event using Prisma.
Sessions are then created under the event:
POST /api/events/:eventId/sessions
Sessions contain:
- Title
- Start time
- Duration
- Location
- Capacity
Events also support:
- Description
- Venue
- Start date
- End date
- Archive/restore
Archived events remain in the database and are hidden from normal active-event views.
## 8. Registration Lifecycle
The registration lifecycle is enforced by the backend.
Primary lifecycle:
Reserved → Confirmed → Checked In
Cancellation is allowed from:
- Reserved
- Confirmed
Reserved registrations can also automatically become:
Reserved → Expired
Checked-in, cancelled, and expired registrations are terminal states.
The backend rejects invalid state transitions and returns an explanatory error.
## 9. Capacity Management
Capacity counts registrations in:
- `RESERVED`
- `CONFIRMED`
- `CHECKED_IN`
Cancelled and expired registrations do not consume capacity.
Registration creation checks the current occupied count before creating a reservation.
Session capacity cannot be reduced below the number of currently occupied seats.
Automatic reservation expiry runs periodically and updates expired reservations.
## 10. Staff Assignment
Staff assignments use a many-to-many relationship between users and sessions through `StaffAssignment`.
An organizer can:
- Assign staff to a session
- Remove staff from a session
A staff member can be assigned to multiple sessions and can view one combined list of their assigned sessions.
The backend validates that assigned users have the `CHECKIN_STAFF` role.
## 11. Search, Filtering and Pagination
Registration management is implemented server-side.
Supported capabilities include:
- Attendee name search
- Attendee email search
- Event filtering
- Session filtering
- Registration status filtering
- Sorting by reservation time
- Sorting by status
- Sorting by session
- Ascending/descending ordering
- Pagination
- Total result count
- Total page count
This keeps filtering and pagination logic on the server rather than loading the entire registration dataset into the browser.
## 12. CSV Import and Export
CSV import is handled by the backend using Multer.
Import processing provides per-row outcomes:
- `CREATED`
- `DUPLICATE`
- `REJECTED`
Rejected rows include a reason.
A valid row is still processed even when another row in the same file fails validation.
CSV export generates a check-in-oriented registration sheet using server-side filters.
## 13. Immutable History
Every important registration lifecycle action is recorded in `RegistrationHistory`.
History records contain:
- Registration
- Actor
- Action
- Previous status
- New status
- Note
- Timestamp
History records are append-only. The application does not provide edit or delete operations for history entries.
This preserves an audit trail for registration lifecycle changes.
## 14. Capacity Alerts and Dashboard
The organizer dashboard aggregates operational information including:
- Sessions today
- Checked-in attendees today
- Expired registrations this week
- Sessions at capacity
- Registration status breakdown
- Session breakdown
- Check-ins for the last 14 days
Capacity alerts are associated with sessions.
An organizer can dismiss an active capacity alert.
When a seat is freed and the session later reaches capacity again, a new capacity alert is created instead of repeatedly recreating the same alert without a capacity change.
## 15. Error Handling
The backend uses appropriate HTTP status codes for common failures, including:
- `400` — validation errors
- `401` — missing/invalid authentication
- `403` — insufficient permissions
- `404` — resource not found
- `409` — conflicts such as duplicates/capacity conflicts
- `500` — unexpected server errors
The frontend displays API errors to users rather than silently ignoring failures.
## 16. Database Layer
Prisma provides the database access layer.
The main entities are:
- User
- Event
- Session
- Registration
- StaffAssignment
- RegistrationHistory
- Alert
Relationships and indexes are defined in `prisma/schema.prisma`.
MySQL provides persistent storage.
## 17. Deployment Architecture
The intended production architecture is:
Browser
↓
Hosted React/Vite frontend
↓
Hosted Express API
↓
Managed MySQL database
Environment-specific configuration is supplied through environment variables.
Secrets such as database credentials and JWT signing secrets are not stored in source code.
## 18. Security Considerations
The implementation includes:
- bcrypt password hashing
- JWT authentication
- Server-side role authorization
- Database-backed current-user lookup
- Input validation
- Duplicate prevention
- Capacity enforcement
- Registration transition validation
- Staff/session authorization
- Protection against unauthorized organizer registration
- No development-only testing endpoints in the final backend
Development-only manual expiry and test-session endpoints were removed before finalization.
## 19. Design Rationale
The application intentionally uses a conventional monolithic full-stack architecture rather than microservices.
This provides:
- Lower operational complexity
- Faster development
- Easier local setup
- Easier deployment
- Straightforward debugging
- Clear separation between UI, API and persistence
The architecture is sufficient for the assignment scope while leaving room for future modularization if the system grows.
