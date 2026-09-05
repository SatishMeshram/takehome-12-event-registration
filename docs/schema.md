# Database Schema

The application uses MySQL with Prisma ORM.

## 1. Table by table: what columns and types does each one have?

### User

Stores both organizers and check-in staff.

| Column | Type | Purpose |
|---|---|---|
| id | String | Primary key |
| name | String | User name |
| email | String | Unique login email |
| password | String | bcrypt password hash |
| role | UserRole | ORGANIZER or CHECKIN_STAFF |
| createdAt | DateTime | Account creation time |
| updatedAt | DateTime | Last update time |

### Event

Stores the top-level event information.

| Column | Type | Purpose |
|---|---|---|
| id | String | Primary key |
| name | String | Event name |
| description | String? | Optional event description |
| venue | String? | Optional event venue |
| startDate | DateTime? | Optional event start date |
| endDate | DateTime? | Optional event end date |
| archivedAt | DateTime? | Archive timestamp |
| createdAt | DateTime | Creation time |
| updatedAt | DateTime | Last update time |

An event contains multiple sessions. Archiving uses archivedAt instead of deleting the event, so the event and its related data can be restored.

### Session

Stores individual sessions belonging to an event.

| Column | Type | Purpose |
|---|---|---|
| id | String | Primary key |
| eventId | String | Foreign key to Event |
| title | String | Session title |
| startTime | DateTime | Session start time |
| duration | Int | Duration in minutes |
| location | String | Session location |
| capacity | Int | Maximum occupied registrations |
| createdAt | DateTime | Creation time |
| updatedAt | DateTime | Last update time |

### Registration

Stores attendee registrations and their current lifecycle state.

| Column | Type | Purpose |
|---|---|---|
| id | String | Primary key |
| sessionId | String | Foreign key to Session |
| name | String | Attendee name |
| email | String | Attendee email |
| phone | String? | Optional phone |
| status | RegistrationStatus | Current lifecycle state |
| reservedAt | DateTime | Reservation time |
| expiresAt | DateTime? | Reservation expiry |
| confirmedAt | DateTime? | Confirmation time |
| checkedInAt | DateTime? | Check-in time |
| cancelledAt | DateTime? | Cancellation time |
| createdAt | DateTime | Creation time |
| updatedAt | DateTime | Last update time |

Capacity is calculated from registrations in RESERVED, CONFIRMED, and CHECKED_IN states. CANCELLED and EXPIRED registrations do not consume capacity.

### StaffAssignment

Join table connecting check-in staff users with sessions.

| Column | Type | Purpose |
|---|---|---|
| id | String | Primary key |
| sessionId | String | Foreign key to Session |
| userId | String | Foreign key to User |
| createdAt | DateTime | Assignment time |

The database has a composite unique constraint on sessionId and userId so the same staff member cannot be assigned to the same session twice.

### RegistrationHistory

Stores the immutable audit trail for registration actions.

| Column | Type | Purpose |
|---|---|---|
| id | String | Primary key |
| registrationId | String | Foreign key to Registration |
| actorId | String? | User who performed the action |
| action | String | Action performed |
| oldStatus | String? | Previous status |
| newStatus | String? | New status |
| note | String? | Additional explanation |
| createdAt | DateTime | History timestamp |

### Alert

Stores capacity alerts associated with sessions.

| Column | Type | Purpose |
|---|---|---|
| id | String | Primary key |
| sessionId | String | Foreign key to Session |
| type | AlertType | Currently AT_CAPACITY |
| message | String | Alert message |
| dismissed | Boolean | Whether the organizer dismissed the alert |
| createdAt | DateTime | Alert creation time |
| dismissedAt | DateTime? | Dismissal time |

### Enums

- UserRole: ORGANIZER, CHECKIN_STAFF
- RegistrationStatus: RESERVED, CONFIRMED, CHECKED_IN, CANCELLED, EXPIRED
- AlertType: AT_CAPACITY

## 2. Which relationships are one-to-many, and which are many-to-many?

### One-to-many

- One Event has many Sessions.
- One Session has many Registrations.
- One Session has many StaffAssignment records.
- One Session has many Alerts.
- One Registration has many RegistrationHistory entries.
- One User can have many StaffAssignment records.
- One User can appear as actor on many RegistrationHistory entries.

### Many-to-many

Users and Sessions have a many-to-many relationship for check-in staff assignment.

A staff member can be assigned to many sessions, and a session can have many staff members. This is implemented through StaffAssignment.

## 3. Which constraints are enforced by the database, and which by application code?

### Database-enforced constraints

- Primary keys are enforced for all tables.
- User.email is unique.
- StaffAssignment has a unique combination of sessionId and userId.
- Foreign keys maintain relationships between related records.
- Enum columns restrict role, registration status, and alert type to defined values.
- Indexed fields support common lookups such as eventId, sessionId, status, email, and reservedAt.

### Application-enforced constraints

- Only organizers can create, edit, archive, or restore events.
- Only organizers can create, edit, or delete sessions.
- Only organizers can assign or remove staff.
- Only assigned check-in staff can check attendees in.
- Registration lifecycle transitions are explicitly validated.
- Capacity rules are checked before registration creation.
- Capacity cannot be reduced below currently occupied registrations.
- Reserved registrations automatically expire after the holding period.
- Archived events are hidden from normal active views.
- CSV row validation and duplicate handling are implemented by the API.

The database is responsible for structural integrity, uniqueness, and relationships. Business workflows are kept in application code because rules such as lifecycle transitions, authorization, capacity behavior, and expiry depend on current application state and user permissions.

## 4. What did you deliberately denormalise?

The schema is intentionally mostly normalized. I did not duplicate event or session names inside Registration because those values can be obtained through relationships.

The main deliberate trade-off is keeping lifecycle timestamps such as reservedAt, expiresAt, confirmedAt, checkedInAt, and cancelledAt directly on Registration. This avoids calculating common operational information from the history table every time the registration list or dashboard is queried.

RegistrationHistory remains the source of the immutable audit trail, while Registration stores the current operational state and important timestamps.

## 5. What would break first if this had 100x the data?

The first pressure points would likely be registration-list queries, dashboard aggregation, history growth, concurrent capacity checks, and large CSV imports.

### Registration queries

Search, filtering, sorting, and pagination would need stronger composite indexes and query tuning. Existing indexes provide a starting point.

### Dashboard

Repeated aggregation across a much larger registration table could become expensive. Precomputed counters, caching, or scheduled aggregation could reduce the cost.

### Registration history

History would grow continuously. At larger scale it could require archival or partitioning while preserving audit access.

### Capacity concurrency

High concurrent registration traffic would make seat allocation the most important consistency concern. Capacity updates would need stronger transaction/locking strategies or an atomic reservation mechanism.

### CSV import

Very large files should be processed asynchronously through a background job instead of keeping the HTTP request open.

### Overall scaling approach

I would first optimize database indexes and queries, then introduce caching and background jobs where measurement shows they are needed. I would avoid prematurely splitting the application into microservices.
