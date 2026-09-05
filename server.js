const express = require("express");
const cors = require("cors");
require("dotenv").config();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

// ========================================
// Environment validation
// ========================================
if (!process.env.DB_PASSWORD) {
  throw new Error("DB_PASSWORD is missing from .env");
}

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing from .env");
}

// ========================================
// Prisma + MySQL connection
// ========================================
const adapter = new PrismaMariaDb({
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: process.env.DB_PASSWORD,
  database: "event_registration",
});

const prisma = new PrismaClient({ adapter });

// ========================================
// Express app
// ========================================
const app = express();
const PORT = process.env.PORT || 5000;

// ========================================
// Middleware
// ========================================
app.use(cors());
app.use(express.json());

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ========================================
// CSV helpers
// ========================================
function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.toLowerCase().trim()
  );

  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });

  return { headers, rows };
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvDate(value) {
  if (!value) return "";
  return new Date(value).toISOString();
}

// ========================================
// Helper: validate date
// ========================================
function parseValidDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

// ========================================
// Helper: validate positive integer
// ========================================
function isPositiveInteger(value) {
  return (
    Number.isInteger(value) &&
    value > 0
  );
}

// ========================================
// Authentication middleware
// ========================================
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (
    !authHeader ||
    !authHeader.startsWith("Bearer ")
  ) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    // ----------------------------------------
    // Verify user still exists
    // ----------------------------------------
    const user = await prisma.user.findUnique({
      where: {
        id: decoded.userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "User account no longer exists.",
      });
    }

    // Use current database role
    req.user = user;

    next();
  } catch (error) {
    console.error(
      "Authentication failed:",
      error.message
    );

    return res.status(401).json({
      success: false,
      message:
        "Invalid or expired authentication token.",
    });
  }
}

// ========================================
// Role authorization middleware
// ========================================
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (
      !allowedRoles.includes(req.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You do not have permission to perform this action.",
        requiredRoles: allowedRoles,
        currentRole: req.user.role,
      });
    }

    next();
  };
}

// ========================================
// Main route
// ========================================
app.get("/", (req, res) => {
  res.json({
    message:
      "Event Registration API is running 🚀",
  });
});

// ========================================
// API health check
// ========================================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "event-registration-api",
  });
});

// ========================================
// Database connection test
// ========================================
app.get("/api/db-test", async (req, res) => {
  try {
    const userCount =
      await prisma.user.count();

    res.json({
      success: true,
      database: "connected",
      userCount,
    });
  } catch (error) {
    console.error(
      "Database test failed:",
      error
    );

    res.status(500).json({
      success: false,
      database: "connection failed",
      message: error.message,
    });
  }
});

// ========================================
// AUTH - Register
// ========================================
app.post(
  "/api/auth/register",
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        role,
      } = req.body;

      if (
        !name ||
        !email ||
        !password ||
        !role
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Name, email, password and role are required.",
        });
      }

      if (
        typeof name !== "string" ||
        name.trim().length < 2
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Name must contain at least 2 characters.",
        });
      }

      if (
        typeof email !== "string" ||
        email.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid email is required.",
        });
      }

      const normalizedEmail =
        email.trim().toLowerCase();

      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide a valid email address.",
        });
      }

      if (
        typeof password !== "string" ||
        password.length < 8
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Password must contain at least 8 characters.",
        });
      }

      const allowedRoles = [
        "ORGANIZER",
        "CHECKIN_STAFF",
      ];

      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role.",
          allowedRoles,
        });
      }

      const existingUser =
        await prisma.user.findUnique({
          where: {
            email: normalizedEmail,
          },
        });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message:
            "An account with this email already exists.",
        });
      }

      const hashedPassword =
        await bcrypt.hash(password, 12);

      const user =
        await prisma.user.create({
          data: {
            name: name.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            role,
          },
        });

      res.status(201).json({
        success: true,
        message:
          "Account created successfully.",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      console.error(
        "Registration failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to create account.",
      });
    }
  }
);

// ========================================
// AUTH - Login
// ========================================
app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const {
        email,
        password,
      } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message:
            "Email and password are required.",
        });
      }

      if (
        typeof email !== "string" ||
        typeof password !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Email and password must be valid strings.",
        });
      }

      const normalizedEmail =
        email.trim().toLowerCase();

      const user =
        await prisma.user.findUnique({
          where: {
            email: normalizedEmail,
          },
        });

      if (!user) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid email or password.",
        });
      }

      const passwordMatches =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!passwordMatches) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid email or password.",
        });
      }

      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role,
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "8h",
        }
      );

      res.json({
        success: true,
        message: "Login successful.",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      console.error(
        "Login failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to login.",
      });
    }
  }
);

// ========================================
// AUTH - Current user
// ========================================
app.get(
  "/api/auth/me",
  authenticateToken,
  async (req, res) => {
    res.json({
      success: true,
      user: req.user,
    });
  }
);

// ========================================
// AUTH - Protected test endpoint
// ========================================
app.get(
  "/api/auth/protected-test",
  authenticateToken,
  (req, res) => {
    res.json({
      success: true,
      message:
        "You accessed a protected endpoint.",
      user: req.user,
    });
  }
);

// ========================================
// RBAC - Organizer only test
// ========================================
app.get(
  "/api/auth/organizer-test",
  authenticateToken,
  requireRole("ORGANIZER"),
  (req, res) => {
    res.json({
      success: true,
      message:
        "Organizer authorization successful.",
      user: req.user,
    });
  }
);

// ========================================
// RBAC - Check-in staff only test
// ========================================
app.get(
  "/api/auth/staff-test",
  authenticateToken,
  requireRole("CHECKIN_STAFF"),
  (req, res) => {
    res.json({
      success: true,
      message:
        "Check-in staff authorization successful.",
      user: req.user,
    });
  }
);

// ========================================
// EVENT MANAGEMENT
// ========================================

// ----------------------------------------
// Create event
// ORGANIZER ONLY
// ----------------------------------------
app.post(
  "/api/events",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const {
        name,
        description,
        startDate,
        endDate,
      } = req.body;

      // --------------------------------------
      // Validate name
      // --------------------------------------
      if (
        typeof name !== "string" ||
        name.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Event name is required.",
        });
      }

      if (name.trim().length > 200) {
        return res.status(400).json({
          success: false,
          message:
            "Event name cannot exceed 200 characters.",
        });
      }

      // --------------------------------------
      // Validate description
      // --------------------------------------
      if (
        description !== undefined &&
        description !== null &&
        typeof description !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Description must be a string.",
        });
      }

      // --------------------------------------
      // Validate dates
      // --------------------------------------
      let parsedStartDate = null;
      let parsedEndDate = null;

      if (
        startDate !== undefined &&
        startDate !== null &&
        startDate !== ""
      ) {
        parsedStartDate =
          parseValidDate(startDate);

        if (!parsedStartDate) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid start date.",
          });
        }
      }

      if (
        endDate !== undefined &&
        endDate !== null &&
        endDate !== ""
      ) {
        parsedEndDate =
          parseValidDate(endDate);

        if (!parsedEndDate) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid end date.",
          });
        }
      }

      if (
        parsedStartDate &&
        parsedEndDate &&
        parsedEndDate < parsedStartDate
      ) {
        return res.status(400).json({
          success: false,
          message:
            "End date cannot be earlier than start date.",
        });
      }

      const event =
        await prisma.event.create({
          data: {
            name: name.trim(),
            description:
              typeof description === "string" &&
              description.trim() !== ""
                ? description.trim()
                : null,
            startDate: parsedStartDate,
            endDate: parsedEndDate,
          },
          include: {
            _count: {
              select: {
                sessions: true,
              },
            },
          },
        });

      res.status(201).json({
        success: true,
        message:
          "Event created successfully.",
        event: {
          id: event.id,
          name: event.name,
          description: event.description,
          startDate: event.startDate,
          endDate: event.endDate,
          archivedAt: event.archivedAt,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
          sessionCount:
            event._count.sessions,
        },
      });
    } catch (error) {
      console.error(
        "Event creation failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to create event.",
      });
    }
  }
);

// ----------------------------------------
// List events
// Active events are public.
// Organizers may use ?includeArchived=true
// ----------------------------------------
app.get(
  "/api/events",
  async (req, res) => {
    try {
      const includeArchived =
        req.query.includeArchived ===
        "true";

      // Only authenticated organizers
      // can request archived events.
      if (includeArchived) {
        const authHeader =
          req.headers.authorization;

        if (
          !authHeader ||
          !authHeader.startsWith(
            "Bearer "
          )
        ) {
          return res.status(401).json({
            success: false,
            message:
              "Authentication required to view archived events.",
          });
        }

        const token =
          authHeader.substring(7);

        try {
          const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
          );

          const user =
            await prisma.user.findUnique({
              where: {
                id: decoded.userId,
              },
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            });

          if (!user) {
            return res.status(401).json({
              success: false,
              message:
                "User account no longer exists.",
            });
          }

          if (user.role !== "ORGANIZER") {
            return res.status(403).json({
              success: false,
              message:
                "Only organizers can view archived events.",
            });
          }
        } catch (error) {
          return res.status(401).json({
            success: false,
            message:
              "Invalid or expired authentication token.",
          });
        }
      }

      const events =
        await prisma.event.findMany({
          where: includeArchived
            ? {}
            : {
                archivedAt: null,
              },
          orderBy: {
            startDate: "asc",
          },
          include: {
            _count: {
              select: {
                sessions: true,
              },
            },
          },
        });

      res.json({
        success: true,
        count: events.length,
        events: events.map((event) => ({
          id: event.id,
          name: event.name,
          description: event.description,
          startDate: event.startDate,
          endDate: event.endDate,
          archivedAt: event.archivedAt,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
          sessionCount:
            event._count.sessions,
        })),
      });
    } catch (error) {
      console.error(
        "Event list failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to fetch events.",
      });
    }
  }
);

// ----------------------------------------
// Get event details
// Active events are public.
// Archived event requires organizer.
// ----------------------------------------
app.get(
  "/api/events/:eventId",
  async (req, res) => {
    try {
      const {
        eventId,
      } = req.params;

      if (
        !eventId ||
        eventId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid event ID is required.",
        });
      }

      const event =
        await prisma.event.findUnique({
          where: {
            id: eventId.trim(),
          },
          include: {
            sessions: {
              orderBy: {
                startTime: "asc",
              },
              include: {
                _count: {
                  select: {
                    registrations: true,
                    staffAssignments: true,
                  },
                },
              },
            },
          },
        });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      // Archived events are hidden
      // from unauthenticated/public users.
      if (event.archivedAt) {
        const authHeader =
          req.headers.authorization;

        if (
          !authHeader ||
          !authHeader.startsWith(
            "Bearer "
          )
        ) {
          return res.status(404).json({
            success: false,
            message: "Event not found.",
          });
        }

        const token =
          authHeader.substring(7);

        try {
          const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
          );

          const user =
            await prisma.user.findUnique({
              where: {
                id: decoded.userId,
              },
              select: {
                id: true,
                role: true,
              },
            });

          if (
            !user ||
            user.role !== "ORGANIZER"
          ) {
            return res.status(404).json({
              success: false,
              message: "Event not found.",
            });
          }
        } catch (error) {
          return res.status(404).json({
            success: false,
            message: "Event not found.",
          });
        }
      }

      res.json({
        success: true,
        event: {
          id: event.id,
          name: event.name,
          description: event.description,
          startDate: event.startDate,
          endDate: event.endDate,
          archivedAt: event.archivedAt,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
          sessions:
            event.sessions.map(
              (session) => ({
                id: session.id,
                title: session.title,
                startTime:
                  session.startTime,
                duration:
                  session.duration,
                location:
                  session.location,
                capacity:
                  session.capacity,
                createdAt:
                  session.createdAt,
                updatedAt:
                  session.updatedAt,
                registrationCount:
                  session._count
                    .registrations,
                staffCount:
                  session._count
                    .staffAssignments,
              })
            ),
        },
      });
    } catch (error) {
      console.error(
        "Event details failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to fetch event.",
      });
    }
  }
);

// ----------------------------------------
// Update event
// ORGANIZER ONLY
// ----------------------------------------
app.patch(
  "/api/events/:eventId",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const {
        eventId,
      } = req.params;

      const {
        name,
        description,
        startDate,
        endDate,
      } = req.body;

      if (
        !eventId ||
        eventId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid event ID is required.",
        });
      }

      const existingEvent =
        await prisma.event.findUnique({
          where: {
            id: eventId.trim(),
          },
        });

      if (!existingEvent) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      if (existingEvent.archivedAt) {
        return res.status(409).json({
          success: false,
          message:
            "Archived events cannot be edited. Restore the event first.",
        });
      }

      const data = {};

      if (name !== undefined) {
        if (
          typeof name !== "string" ||
          name.trim() === ""
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Event name must be a non-empty string.",
          });
        }

        if (name.trim().length > 200) {
          return res.status(400).json({
            success: false,
            message:
              "Event name cannot exceed 200 characters.",
          });
        }

        data.name = name.trim();
      }

      if (description !== undefined) {
        if (
          description !== null &&
          typeof description !== "string"
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Description must be a string or null.",
          });
        }

        data.description =
          typeof description === "string" &&
          description.trim() !== ""
            ? description.trim()
            : null;
      }

      let newStartDate =
        existingEvent.startDate;
      let newEndDate =
        existingEvent.endDate;

      if (startDate !== undefined) {
        if (
          startDate === null ||
          startDate === ""
        ) {
          newStartDate = null;
        } else {
          newStartDate =
            parseValidDate(startDate);

          if (!newStartDate) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid start date.",
            });
          }
        }

        data.startDate = newStartDate;
      }

      if (endDate !== undefined) {
        if (
          endDate === null ||
          endDate === ""
        ) {
          newEndDate = null;
        } else {
          newEndDate =
            parseValidDate(endDate);

          if (!newEndDate) {
            return res.status(400).json({
              success: false,
              message:
                "Invalid end date.",
            });
          }
        }

        data.endDate = newEndDate;
      }

      if (
        newStartDate &&
        newEndDate &&
        newEndDate < newStartDate
      ) {
        return res.status(400).json({
          success: false,
          message:
            "End date cannot be earlier than start date.",
        });
      }

      const event =
        await prisma.event.update({
          where: {
            id: existingEvent.id,
          },
          data,
          include: {
            _count: {
              select: {
                sessions: true,
              },
            },
          },
        });

      res.json({
        success: true,
        message:
          "Event updated successfully.",
        event: {
          id: event.id,
          name: event.name,
          description: event.description,
          startDate: event.startDate,
          endDate: event.endDate,
          archivedAt: event.archivedAt,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
          sessionCount:
            event._count.sessions,
        },
      });
    } catch (error) {
      console.error(
        "Event update failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to update event.",
      });
    }
  }
);

// ----------------------------------------
// Archive event
// ORGANIZER ONLY
// ----------------------------------------
app.post(
  "/api/events/:eventId/archive",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const {
        eventId,
      } = req.params;

      if (
        !eventId ||
        eventId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid event ID is required.",
        });
      }

      const event =
        await prisma.event.findUnique({
          where: {
            id: eventId.trim(),
          },
        });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      if (event.archivedAt) {
        return res.status(409).json({
          success: false,
          message:
            "Event is already archived.",
        });
      }

      const archivedEvent =
        await prisma.event.update({
          where: {
            id: event.id,
          },
          data: {
            archivedAt: new Date(),
          },
        });

      res.json({
        success: true,
        message:
          "Event archived successfully.",
        event: {
          id: archivedEvent.id,
          name: archivedEvent.name,
          archivedAt:
            archivedEvent.archivedAt,
        },
      });
    } catch (error) {
      console.error(
        "Event archive failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to archive event.",
      });
    }
  }
);

// ----------------------------------------
// Restore event
// ORGANIZER ONLY
// ----------------------------------------
app.post(
  "/api/events/:eventId/restore",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const {
        eventId,
      } = req.params;

      if (
        !eventId ||
        eventId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid event ID is required.",
        });
      }

      const event =
        await prisma.event.findUnique({
          where: {
            id: eventId.trim(),
          },
        });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      if (!event.archivedAt) {
        return res.status(409).json({
          success: false,
          message:
            "Event is not archived.",
        });
      }

      const restoredEvent =
        await prisma.event.update({
          where: {
            id: event.id,
          },
          data: {
            archivedAt: null,
          },
        });

      res.json({
        success: true,
        message:
          "Event restored successfully.",
        event: {
          id: restoredEvent.id,
          name: restoredEvent.name,
          archivedAt:
            restoredEvent.archivedAt,
        },
      });
    } catch (error) {
      console.error(
        "Event restore failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to restore event.",
      });
    }
  }
);

// ========================================
// SESSION MANAGEMENT
// ========================================

// ----------------------------------------
// Create session
// ORGANIZER ONLY
// ----------------------------------------
app.post(
  "/api/events/:eventId/sessions",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const {
        eventId,
      } = req.params;

      const {
        title,
        startTime,
        duration,
        location,
        capacity,
      } = req.body;

      if (
        !eventId ||
        eventId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid event ID is required.",
        });
      }

      if (
        typeof title !== "string" ||
        title.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Session title is required.",
        });
      }

      if (
        typeof startTime !== "string" ||
        startTime.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Session start time is required.",
        });
      }

      const parsedStartTime =
        parseValidDate(startTime);

      if (!parsedStartTime) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid session start time.",
        });
      }

      if (
        !isPositiveInteger(duration)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Duration must be a positive integer in minutes.",
        });
      }

      if (
        typeof location !== "string" ||
        location.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Session location is required.",
        });
      }

      if (
        !isPositiveInteger(capacity)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Capacity must be a positive integer.",
        });
      }

      const event =
        await prisma.event.findUnique({
          where: {
            id: eventId.trim(),
          },
        });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      if (event.archivedAt) {
        return res.status(409).json({
          success: false,
          message:
            "Cannot add a session to an archived event.",
        });
      }

      // --------------------------------------
      // Session must fit within event dates
      // when event dates are defined.
      // --------------------------------------
      if (
        event.startDate &&
        parsedStartTime < event.startDate
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Session start time cannot be before the event start date.",
        });
      }

      if (
        event.endDate &&
        parsedStartTime > event.endDate
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Session start time cannot be after the event end date.",
        });
      }

      const session =
        await prisma.session.create({
          data: {
            eventId: event.id,
            title: title.trim(),
            startTime: parsedStartTime,
            duration,
            location: location.trim(),
            capacity,
          },
        });

      res.status(201).json({
        success: true,
        message:
          "Session created successfully.",
        session,
      });
    } catch (error) {
      console.error(
        "Session creation failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to create session.",
      });
    }
  }
);

// ----------------------------------------
// List sessions for event
// ----------------------------------------
app.get(
  "/api/events/:eventId/sessions",
  async (req, res) => {
    try {
      const {
        eventId,
      } = req.params;

      if (
        !eventId ||
        eventId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid event ID is required.",
        });
      }

      const event =
        await prisma.event.findUnique({
          where: {
            id: eventId.trim(),
          },
        });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      if (event.archivedAt) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      const sessions =
        await prisma.session.findMany({
          where: {
            eventId: event.id,
          },
          orderBy: {
            startTime: "asc",
          },
          include: {
            _count: {
              select: {
                registrations: true,
                staffAssignments: true,
              },
            },
          },
        });

      res.json({
        success: true,
        event: {
          id: event.id,
          name: event.name,
        },
        count: sessions.length,
        sessions:
          sessions.map((session) => ({
            id: session.id,
            title: session.title,
            startTime:
              session.startTime,
            duration:
              session.duration,
            location:
              session.location,
            capacity:
              session.capacity,
            createdAt:
              session.createdAt,
            updatedAt:
              session.updatedAt,
            registrationCount:
              session._count
                .registrations,
            staffCount:
              session._count
                .staffAssignments,
          })),
      });
    } catch (error) {
      console.error(
        "Session list failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to fetch sessions.",
      });
    }
  }
);

// ----------------------------------------
// Get session details
// ----------------------------------------
app.get(
  "/api/sessions/:sessionId",
  async (req, res) => {
    try {
      const {
        sessionId,
      } = req.params;

      if (
        !sessionId ||
        sessionId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid session ID is required.",
        });
      }

      const session =
        await prisma.session.findUnique({
          where: {
            id: sessionId.trim(),
          },
          include: {
            event: true,
            _count: {
              select: {
                registrations: true,
                staffAssignments: true,
              },
            },
          },
        });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Session not found.",
        });
      }

      if (session.event.archivedAt) {
        return res.status(404).json({
          success: false,
          message: "Session not found.",
        });
      }

      res.json({
        success: true,
        session: {
          id: session.id,
          title: session.title,
          startTime:
            session.startTime,
          duration:
            session.duration,
          location:
            session.location,
          capacity:
            session.capacity,
          createdAt:
            session.createdAt,
          updatedAt:
            session.updatedAt,
          event: {
            id: session.event.id,
            name: session.event.name,
          },
          registrationCount:
            session._count
              .registrations,
          staffCount:
            session._count
              .staffAssignments,
        },
      });
    } catch (error) {
      console.error(
        "Session details failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to fetch session.",
      });
    }
  }
);

// ----------------------------------------
// Update session
// ORGANIZER ONLY
// ----------------------------------------
app.patch(
  "/api/sessions/:sessionId",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const {
        sessionId,
      } = req.params;

      const {
        title,
        startTime,
        duration,
        location,
        capacity,
      } = req.body;

      if (
        !sessionId ||
        sessionId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid session ID is required.",
        });
      }

      const existingSession =
        await prisma.session.findUnique({
          where: {
            id: sessionId.trim(),
          },
          include: {
            event: true,
          },
        });

      if (!existingSession) {
        return res.status(404).json({
          success: false,
          message:
            "Session not found.",
        });
      }

      if (existingSession.event.archivedAt) {
        return res.status(409).json({
          success: false,
          message:
            "Sessions of archived events cannot be edited. Restore the event first.",
        });
      }

      const data = {};

      if (title !== undefined) {
        if (
          typeof title !== "string" ||
          title.trim() === ""
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Session title must be a non-empty string.",
          });
        }

        data.title = title.trim();
      }

      let newStartTime =
        existingSession.startTime;

      if (startTime !== undefined) {
        if (
          typeof startTime !== "string" ||
          startTime.trim() === ""
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Valid session start time is required.",
          });
        }

        newStartTime =
          parseValidDate(startTime);

        if (!newStartTime) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid session start time.",
          });
        }

        data.startTime = newStartTime;
      }

      if (duration !== undefined) {
        if (
          !isPositiveInteger(duration)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Duration must be a positive integer in minutes.",
          });
        }

        data.duration = duration;
      }

      if (location !== undefined) {
        if (
          typeof location !== "string" ||
          location.trim() === ""
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Session location must be a non-empty string.",
          });
        }

        data.location =
          location.trim();
      }

      if (capacity !== undefined) {
        if (
          !isPositiveInteger(capacity)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Capacity must be a positive integer.",
          });
        }

        const occupiedCount =
          await prisma.registration.count(
            {
              where: {
                sessionId:
                  existingSession.id,
                status: {
                  in: [
                    "RESERVED",
                    "CONFIRMED",
                    "CHECKED_IN",
                  ],
                },
              },
            }
          );

        if (
          capacity < occupiedCount
        ) {
          return res.status(409).json({
            success: false,
            message:
              "Capacity cannot be lower than currently occupied seats.",
            occupied:
              occupiedCount,
            requestedCapacity:
              capacity,
          });
        }

        data.capacity = capacity;
      }

      // --------------------------------------
      // Validate session against event dates
      // --------------------------------------
      if (
        existingSession.event
          .startDate &&
        newStartTime <
          existingSession.event
            .startDate
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Session start time cannot be before the event start date.",
        });
      }

      if (
        existingSession.event.endDate &&
        newStartTime >
          existingSession.event
            .endDate
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Session start time cannot be after the event end date.",
        });
      }

      const session =
        await prisma.session.update({
          where: {
            id: existingSession.id,
          },
          data,
        });

      res.json({
        success: true,
        message:
          "Session updated successfully.",
        session,
      });
    } catch (error) {
      console.error(
        "Session update failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to update session.",
      });
    }
  }
);

// ----------------------------------------
// Delete session
// ORGANIZER ONLY
//
// Safety:
// A session cannot be deleted when it has
// registrations or staff assignments.
// ----------------------------------------
app.delete(
  "/api/sessions/:sessionId",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const {
        sessionId,
      } = req.params;

      if (
        !sessionId ||
        sessionId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid session ID is required.",
        });
      }

      const session =
        await prisma.session.findUnique({
          where: {
            id: sessionId.trim(),
          },
          include: {
            event: true,
          },
        });

      if (!session) {
        return res.status(404).json({
          success: false,
          message:
            "Session not found.",
        });
      }

      const registrationCount =
        await prisma.registration.count({
          where: {
            sessionId: session.id,
          },
        });

      const staffAssignmentCount =
        await prisma.staffAssignment.count({
          where: {
            sessionId: session.id,
          },
        });

      if (
        registrationCount > 0 ||
        staffAssignmentCount > 0
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Session cannot be deleted because it has related registrations or staff assignments.",
          registrationCount,
          staffAssignmentCount,
        });
      }

      await prisma.session.delete({
        where: {
          id: session.id,
        },
      });

      res.json({
        success: true,
        message:
          "Session deleted successfully.",
        sessionId: session.id,
      });
    } catch (error) {
      console.error(
        "Session deletion failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to delete session.",
      });
    }
  }
);


// ========================================
// STAFF ASSIGNMENT MANAGEMENT
// ========================================

// ----------------------------------------
// Assign check-in staff to a session
// ORGANIZER ONLY
//
// Rules:
// - Staff user must exist.
// - User must have CHECKIN_STAFF role.
// - Session must exist.
// - Archived events cannot receive assignments.
// - Duplicate assignment is rejected safely.
// ----------------------------------------
app.post(
  "/api/sessions/:sessionId/staff",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { userId } = req.body;

      if (
        !sessionId ||
        sessionId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid session ID is required.",
        });
      }

      if (
        typeof userId !== "string" ||
        userId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid staff user ID is required.",
        });
      }

      const session =
        await prisma.session.findUnique({
          where: {
            id: sessionId.trim(),
          },
          include: {
            event: true,
          },
        });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Session not found.",
        });
      }

      if (session.event.archivedAt) {
        return res.status(409).json({
          success: false,
          message:
            "Cannot assign staff to a session belonging to an archived event.",
        });
      }

      const staffUser =
        await prisma.user.findUnique({
          where: {
            id: userId.trim(),
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        });

      if (!staffUser) {
        return res.status(404).json({
          success: false,
          message: "Staff user not found.",
        });
      }

      if (
        staffUser.role !== "CHECKIN_STAFF"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Only CHECKIN_STAFF users can be assigned to sessions.",
          currentRole: staffUser.role,
        });
      }

      const existingAssignment =
        await prisma.staffAssignment.findUnique({
          where: {
            sessionId_userId: {
              sessionId: session.id,
              userId: staffUser.id,
            },
          },
        });

      if (existingAssignment) {
        return res.status(409).json({
          success: false,
          message:
            "This staff member is already assigned to this session.",
          assignmentId:
            existingAssignment.id,
        });
      }

      const assignment =
        await prisma.staffAssignment.create({
          data: {
            sessionId: session.id,
            userId: staffUser.id,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
            session: {
              select: {
                id: true,
                title: true,
                startTime: true,
                duration: true,
                location: true,
                capacity: true,
              },
            },
          },
        });

      return res.status(201).json({
        success: true,
        message:
          "Check-in staff assigned successfully.",
        assignment,
      });
    } catch (error) {
      console.error(
        "Staff assignment failed:",
        error
      );

      if (error.code === "P2002") {
        return res.status(409).json({
          success: false,
          message:
            "This staff member is already assigned to this session.",
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to assign check-in staff.",
      });
    }
  }
);

// ----------------------------------------
// Remove check-in staff from a session
// ORGANIZER ONLY
// ----------------------------------------
app.delete(
  "/api/sessions/:sessionId/staff/:userId",
  authenticateToken,
  requireRole("ORGANIZER"),
  async (req, res) => {
    try {
      const {
        sessionId,
        userId,
      } = req.params;

      if (
        !sessionId ||
        sessionId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid session ID is required.",
        });
      }

      if (
        !userId ||
        userId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid staff user ID is required.",
        });
      }

      const assignment =
        await prisma.staffAssignment.findUnique({
          where: {
            sessionId_userId: {
              sessionId: sessionId.trim(),
              userId: userId.trim(),
            },
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
            session: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        });

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message:
            "Staff assignment not found.",
        });
      }

      await prisma.staffAssignment.delete({
        where: {
          id: assignment.id,
        },
      });

      return res.json({
        success: true,
        message:
          "Check-in staff removed successfully.",
        assignment: {
          id: assignment.id,
          sessionId:
            assignment.sessionId,
          userId:
            assignment.userId,
          staff: assignment.user,
          session:
            assignment.session,
        },
      });
    } catch (error) {
      console.error(
        "Staff removal failed:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to remove check-in staff.",
      });
    }
  }
);

// ----------------------------------------
// Get sessions assigned to current staff
// CHECKIN STAFF ONLY
//
// Security:
// userId is taken from JWT/current account,
// never from request parameters.
// ----------------------------------------
app.get(
  "/api/staff/me/sessions",
  authenticateToken,
  requireRole("CHECKIN_STAFF"),
  async (req, res) => {
    try {
      const assignments =
        await prisma.staffAssignment.findMany({
          where: {
            userId: req.user.id,
          },
          orderBy: {
            session: {
              startTime: "asc",
            },
          },
          include: {
            session: {
              include: {
                event: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    startDate: true,
                    endDate: true,
                    archivedAt: true,
                  },
                },
                _count: {
                  select: {
                    registrations: true,
                    staffAssignments: true,
                  },
                },
              },
            },
          },
        });

      const activeAssignments =
        assignments.filter(
          (assignment) =>
            !assignment.session.event
              .archivedAt
        );

      return res.json({
        success: true,
        staff: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
        },
        count: activeAssignments.length,
        sessions:
          activeAssignments.map(
            (assignment) => ({
              assignmentId:
                assignment.id,
              assignedAt:
                assignment.createdAt,
              session: {
                id:
                  assignment.session.id,
                title:
                  assignment.session.title,
                startTime:
                  assignment.session
                    .startTime,
                duration:
                  assignment.session
                    .duration,
                location:
                  assignment.session
                    .location,
                capacity:
                  assignment.session
                    .capacity,
                registrationCount:
                  assignment.session
                    ._count
                    .registrations,
                staffCount:
                  assignment.session
                    ._count
                    .staffAssignments,
              },
              event:
                assignment.session.event,
            })
          ),
      });
    } catch (error) {
      console.error(
        "Staff session list failed:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch assigned sessions.",
      });
    }
  }
);

// ========================================
// DEVELOPMENT ONLY
// Create test session
// ========================================
app.post(
  "/api/test-session",
  async (req, res) => {
    try {
      const event =
        await prisma.event.create({
          data: {
            name: "Test Event",
            description:
              "Development test event",
          },
        });

      const session =
        await prisma.session.create({
          data: {
            eventId: event.id,
            title: "Test Session",
            startTime: new Date(
              "2026-09-20T10:00:00"
            ),
            duration: 60,
            location: "Bhopal",
            capacity: 2,
          },
        });

      res.status(201).json({
        success: true,
        message:
          "Test session created.",
        event: {
          id: event.id,
          name: event.name,
        },
        session: {
          id: session.id,
          title: session.title,
          capacity:
            session.capacity,
        },
      });
    } catch (error) {
      console.error(
        "Test session creation failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to create test session.",
      });
    }
  }
);

// ========================================
// Registration management list
// Server-side search, filters, sorting and pagination
// ========================================
app.get(
  "/api/registrations",
  authenticateToken,
  async (req, res) => {
    try {
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 10);
      if (!Number.isInteger(page) || page < 1) {
        return res.status(400).json({
          success: false,
          message: "Page must be a positive integer.",
        });
      }
      if (
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 100
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Page size must be an integer between 1 and 100.",
        });
      }
      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim()
          : "";
      const eventId =
        typeof req.query.eventId === "string"
          ? req.query.eventId.trim()
          : "";
      const sessionId =
        typeof req.query.sessionId === "string"
          ? req.query.sessionId.trim()
          : "";
      const status =
        typeof req.query.status === "string"
          ? req.query.status.trim().toUpperCase()
          : "";
      const allowedStatuses = [
        "RESERVED",
        "CONFIRMED",
        "CHECKED_IN",
        "CANCELLED",
        "EXPIRED",
      ];
      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid registration status.",
          allowedStatuses,
        });
      }
      const sort =
        typeof req.query.sort === "string"
          ? req.query.sort.trim()
          : "reservedAt";
      const order =
        typeof req.query.order === "string"
          ? req.query.order.trim().toLowerCase()
          : "desc";
      const allowedSorts = [
        "reservedAt",
        "status",
        "session",
      ];
      if (!allowedSorts.includes(sort)) {
        return res.status(400).json({
          success: false,
          message: "Invalid sort field.",
          allowedSorts,
        });
      }
      if (order !== "asc" && order !== "desc") {
        return res.status(400).json({
          success: false,
          message:
            "Sort order must be either asc or desc.",
        });
      }
      const where = {};
      if (search) {
        where.OR = [
          {
            name: {
              contains: search,
            },
          },
          {
            email: {
              contains: search,
            },
          },
        ];
      }
      if (sessionId) {
        where.sessionId = sessionId;
      }
      if (eventId) {
        where.session = {
          eventId,
        };
      }
      if (status) {
        where.status = status;
      }
      let orderBy;
      if (sort === "reservedAt") {
        orderBy = [
          {
            reservedAt: order,
          },
          {
            id: "asc",
          },
        ];
      } else if (sort === "status") {
        orderBy = [
          {
            status: order,
          },
          {
            reservedAt: "desc",
          },
          {
            id: "asc",
          },
        ];
      } else {
        orderBy = [
          {
            session: {
              title: order,
            },
          },
          {
            reservedAt: "desc",
          },
          {
            id: "asc",
          },
        ];
      }
      const skip = (page - 1) * pageSize;
      const [total, registrations] =
        await prisma.$transaction([
          prisma.registration.count({
            where,
          }),
          prisma.registration.findMany({
            where,
            orderBy,
            skip,
            take: pageSize,
            include: {
              session: {
                select: {
                  id: true,
                  title: true,
                  startTime: true,
                  duration: true,
                  location: true,
                  capacity: true,
                  event: {
                    select: {
                      id: true,
                      name: true,
                      startDate: true,
                      endDate: true,
                      archivedAt: true,
                    },
                  },
                },
              },
            },
          }),
        ]);
      const totalPages =
        total === 0
          ? 0
          : Math.ceil(total / pageSize);
      res.json({
        success: true,
        data: registrations,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNextPage:
            totalPages > 0 &&
            page < totalPages,
          hasPreviousPage:
            page > 1 &&
            page <= totalPages,
        },
        filters: {
          search,
          eventId: eventId || null,
          sessionId: sessionId || null,
          status: status || null,
          sort,
          order,
        },
      });
    } catch (error) {
      console.error(
        "Registration list fetch failed:",
        error
      );
      res.status(500).json({
        success: false,
        message:
          "Failed to fetch registrations.",
      });
    }
  }
);
// ========================================
// Create registration
// Concurrency-safe capacity reservation
// + Registration history
// ========================================
app.post(
  "/api/registrations",
  async (req, res) => {
    try {
      const {
        sessionId,
        name,
        email,
        phone,
      } = req.body;

      if (
        !sessionId ||
        !name ||
        !email
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Session ID, name and email are required.",
        });
      }

      if (
        typeof sessionId !== "string" ||
        sessionId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid session ID is required.",
        });
      }

      if (
        typeof name !== "string" ||
        name.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid attendee name is required.",
        });
      }

      if (
        typeof email !== "string" ||
        email.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid email is required.",
        });
      }

      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (
        !emailRegex.test(
          email.trim()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide a valid email address.",
        });
      }

      const registration =
        await prisma.$transaction(
          async (tx) => {
            const session =
              await tx.session.findUnique(
                {
                  where: {
                    id: sessionId.trim(),
                  },
                  include: {
                    event: true,
                  },
                }
              );

            if (!session) {
              const error =
                new Error(
                  "Session not found."
                );

              error.code =
                "SESSION_NOT_FOUND";

              throw error;
            }

            // Archived events are not open
            // for new registrations.
            if (session.event.archivedAt) {
              const error =
                new Error(
                  "Cannot register for an archived event."
                );

              error.code =
                "EVENT_ARCHIVED";

              throw error;
            }

            await tx.$queryRaw`
              SELECT id
              FROM Session
              WHERE id = ${session.id}
              FOR UPDATE
            `;

            const occupiedCount =
              await tx.registration.count({
                where: {
                  sessionId:
                    session.id,
                  status: {
                    in: [
                      "RESERVED",
                      "CONFIRMED",
                      "CHECKED_IN",
                    ],
                  },
                },
              });

            if (
              occupiedCount >=
              session.capacity
            ) {
              const error =
                new Error(
                  "Session is at capacity."
                );

              error.code =
                "SESSION_AT_CAPACITY";

              error.capacity =
                session.capacity;

              error.occupied =
                occupiedCount;

              throw error;
            }

            const reservedAt =
              new Date();

            const expiresAt =
              new Date(
                reservedAt.getTime() +
                  15 * 60 * 1000
              );

            const newRegistration =
              await tx.registration.create({
                data: {
                  sessionId:
                    session.id,
                  name: name.trim(),
                  email: email
                    .trim()
                    .toLowerCase(),
                  phone:
                    typeof phone ===
                      "string" &&
                    phone.trim() !== ""
                      ? phone.trim()
                      : null,
                  status: "RESERVED",
                  reservedAt,
                  expiresAt,
                },
              });

            await tx.registrationHistory.create(
              {
                data: {
                  registrationId:
                    newRegistration.id,
                  actorId: null,
                  action: "CREATED",
                  oldStatus: null,
                  newStatus:
                    "RESERVED",
                  note:
                    "Registration created and reserved.",
                },
              }
            );

            return newRegistration;
          }
        );

      res.status(201).json({
        success: true,
        message:
          "Registration reserved successfully.",
        registration: {
          id: registration.id,
          sessionId:
            registration.sessionId,
          name: registration.name,
          email: registration.email,
          phone: registration.phone,
          status: registration.status,
          reservedAt:
            registration.reservedAt,
          expiresAt:
            registration.expiresAt,
        },
      });
    } catch (error) {
      console.error(
        "Registration creation failed:",
        error
      );

      if (
        error.code ===
        "SESSION_NOT_FOUND"
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Session not found.",
        });
      }

      if (
        error.code ===
        "EVENT_ARCHIVED"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Cannot register for an archived event.",
        });
      }

      if (
        error.code ===
        "SESSION_AT_CAPACITY"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Session is at capacity.",
          capacity:
            error.capacity,
          occupied:
            error.occupied,
        });
      }

      res.status(500).json({
        success: false,
        message:
          "Failed to create registration.",
      });
    }
  }
);

// ========================================
// Bulk CSV registration import
// ========================================
app.post(
  "/api/registrations/import",
  authenticateToken,
  requireRole("ORGANIZER"),
  csvUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "CSV file is required. Use multipart field name 'file'.",
        });
      }

      const csvText = req.file.buffer.toString("utf8");
      const { headers, rows } = parseCsv(csvText);
      const requiredHeaders = ["sessionId", "name", "email"];
      const normalizedHeaders = headers.map((header) => header.trim());
      const missingHeaders = requiredHeaders.filter(
        (header) => !normalizedHeaders.includes(header.toLowerCase())
      );

      if (missingHeaders.length > 0) {
        return res.status(400).json({
          success: false,
          message: "CSV is missing required columns.",
          requiredColumns: requiredHeaders,
          missingColumns: missingHeaders,
        });
      }

      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "CSV contains no data rows.",
        });
      }

      if (rows.length > 1000) {
        return res.status(400).json({
          success: false,
          message: "CSV may contain at most 1000 data rows per import.",
        });
      }

      const results = [];
      let created = 0;
      let duplicates = 0;
      let rejected = 0;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      for (let index = 0; index < rows.length; index++) {
        const rowNumber = index + 2;
        const row = rows[index];
        const sessionId = (row.sessionid || row.sessionId || "").trim();
        const name = (row.name || "").trim();
        const email = (row.email || "").trim().toLowerCase();
        const phone = (row.phone || "").trim();

        try {
          if (!sessionId || !name || !email) {
            throw Object.assign(
              new Error("sessionId, name and email are required."),
              { code: "INVALID_ROW" }
            );
          }

          if (!emailRegex.test(email)) {
            throw Object.assign(
              new Error("Please provide a valid email address."),
              { code: "INVALID_ROW" }
            );
          }

          const result = await prisma.$transaction(async (tx) => {
            const session = await tx.session.findUnique({
              where: { id: sessionId },
              include: { event: true },
            });

            if (!session) {
              throw Object.assign(new Error("Session not found."), {
                code: "INVALID_ROW",
              });
            }

            if (session.event.archivedAt) {
              throw Object.assign(
                new Error("Cannot register for an archived event."),
                { code: "INVALID_ROW" }
              );
            }

            await tx.$queryRaw`
              SELECT id
              FROM Session
              WHERE id = ${session.id}
              FOR UPDATE
            `;

            const existing = await tx.registration.findFirst({
              where: {
                sessionId: session.id,
                email,
                status: {
                  not: "CANCELLED",
                },
              },
            });

            if (existing) {
              throw Object.assign(
                new Error("Attendee is already registered for this session."),
                { code: "DUPLICATE" }
              );
            }

            const occupiedCount = await tx.registration.count({
              where: {
                sessionId: session.id,
                status: {
                  in: ["RESERVED", "CONFIRMED", "CHECKED_IN"],
                },
              },
            });

            if (occupiedCount >= session.capacity) {
              throw Object.assign(new Error("Session is at capacity."), {
                code: "CAPACITY",
                capacity: session.capacity,
                occupied: occupiedCount,
              });
            }

            const reservedAt = new Date();
            const expiresAt = new Date(reservedAt.getTime() + 15 * 60 * 1000);

            const registration = await tx.registration.create({
              data: {
                sessionId: session.id,
                name,
                email,
                phone: phone || null,
                status: "RESERVED",
                reservedAt,
                expiresAt,
              },
            });

            await tx.registrationHistory.create({
              data: {
                registrationId: registration.id,
                actorId: req.user.id,
                action: "CREATED",
                oldStatus: null,
                newStatus: "RESERVED",
                note: "Registration created through CSV import.",
              },
            });

            return registration;
          });

          created++;
          results.push({
            row: rowNumber,
            status: "CREATED",
            registrationId: result.id,
            sessionId: result.sessionId,
          });
        } catch (error) {
          if (error.code === "DUPLICATE") {
            duplicates++;
            results.push({
              row: rowNumber,
              status: "DUPLICATE",
              reason: error.message,
            });
          } else {
            rejected++;
            results.push({
              row: rowNumber,
              status: "REJECTED",
              reason: error.message || "Row could not be imported.",
              ...(error.code === "CAPACITY"
                ? {
                    capacity: error.capacity,
                    occupied: error.occupied,
                  }
                : {}),
            });
          }
        }
      }

      return res.status(200).json({
        success: true,
        message: "CSV import completed.",
        summary: {
          totalRows: rows.length,
          created,
          duplicates,
          rejected,
        },
        results,
      });
    } catch (error) {
      console.error("CSV registration import failed:", error);

      if (error instanceof multer.MulterError) {
        return res.status(400).json({
          success: false,
          message:
            error.code === "LIMIT_FILE_SIZE"
              ? "CSV file is too large. Maximum size is 2 MB."
              : "CSV upload failed.",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to import registrations from CSV.",
      });
    }
  }
);

// ========================================
// CSV check-in sheet export
// ========================================
app.get(
  "/api/registrations/export",
  authenticateToken,
  requireRole("ORGANIZER", "CHECKIN_STAFF"),
  async (req, res) => {
    try {
      const {
        search,
        eventId,
        sessionId,
        status,
        sort = "reservedAt",
        order = "desc",
      } = req.query;

      const where = {};

      if (search && String(search).trim() !== "") {
        const searchValue = String(search).trim();
        where.OR = [
          { name: { contains: searchValue } },
          { email: { contains: searchValue } },
        ];
      }

      if (status) {
        const allowedStatuses = [
          "RESERVED",
          "CONFIRMED",
          "CHECKED_IN",
          "CANCELLED",
          "EXPIRED",
        ];
        if (!allowedStatuses.includes(String(status))) {
          return res.status(400).json({
            success: false,
            message: "Invalid status filter.",
          });
        }
        where.status = String(status);
      }

      if (sessionId) {
        where.sessionId = String(sessionId);
      }

      if (eventId) {
        where.session = {
          eventId: String(eventId),
        };
      }

      const allowedSorts = {
        reservedAt: { reservedAt: order === "asc" ? "asc" : "desc" },
        status: { status: order === "asc" ? "asc" : "desc" },
        session: { session: { title: order === "asc" ? "asc" : "desc" } },
      };

      const orderBy = allowedSorts[String(sort)] || allowedSorts.reservedAt;

      const registrations = await prisma.registration.findMany({
        where,
        orderBy,
        include: {
          session: {
            include: {
              event: true,
            },
          },
        },
      });

      const header = [
        "Registration ID",
        "Attendee Name",
        "Email",
        "Phone",
        "Event",
        "Session",
        "Session Start",
        "Duration (minutes)",
        "Location",
        "Capacity",
        "Status",
        "Reserved At",
        "Expires At",
        "Confirmed At",
        "Checked In At",
        "Cancelled At",
      ];

      const lines = [header.map(csvEscape).join(",")];

      for (const registration of registrations) {
        lines.push(
          [
            registration.id,
            registration.name,
            registration.email,
            registration.phone,
            registration.session.event.name,
            registration.session.title,
            csvDate(registration.session.startTime),
            registration.session.duration,
            registration.session.location,
            registration.session.capacity,
            registration.status,
            csvDate(registration.reservedAt),
            csvDate(registration.expiresAt),
            csvDate(registration.confirmedAt),
            csvDate(registration.checkedInAt),
            csvDate(registration.cancelledAt),
          ]
            .map(csvEscape)
            .join(",")
        );
      }

      const csv = lines.join("\r\n") + "\r\n";
      const filename = `check-in-sheet-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      return res.send(csv);
    } catch (error) {
      console.error("CSV registration export failed:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to export registrations as CSV.",
      });
    }
  }
);

// ========================================
// Process expired reservations
// ========================================
async function expireReservations() {
  const now = new Date();

  const expiredRegistrations =
    await prisma.registration.findMany({
      where: {
        status: "RESERVED",
        expiresAt: {
          lte: now,
        },
      },
      select: {
        id: true,
      },
    });

  let expiredCount = 0;

  for (
    const registration of expiredRegistrations
  ) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const currentRegistration =
            await tx.registration.findUnique(
              {
                where: {
                  id: registration.id,
                },
              }
            );

          if (!currentRegistration) {
            return;
          }

          if (
            currentRegistration.status !==
            "RESERVED"
          ) {
            return;
          }

          if (
            !currentRegistration.expiresAt ||
            currentRegistration.expiresAt >
              now
          ) {
            return;
          }

          await tx.registration.update({
            where: {
              id: currentRegistration.id,
            },
            data: {
              status: "EXPIRED",
            },
          });

          await tx.registrationHistory.create(
            {
              data: {
                registrationId:
                  currentRegistration.id,
                actorId: null,
                action:
                  "STATUS_CHANGED",
                oldStatus:
                  "RESERVED",
                newStatus:
                  "EXPIRED",
                note:
                  "Reservation expired after holding window.",
              },
            }
          );

          expiredCount++;
        }
      );
    } catch (error) {
      console.error(
        `Failed to expire registration ${registration.id}:`,
        error
      );
    }
  }

  return expiredCount;
}

// ========================================
// Development-only endpoint:
// Force a reservation to expire
// ========================================
app.post(
  "/api/registrations/:registrationId/force-expire",
  async (req, res) => {
    try {
      const {
        registrationId,
      } = req.params;

      if (
        !registrationId ||
        registrationId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid registration ID is required.",
        });
      }

      const registration =
        await prisma.registration.findUnique(
          {
            where: {
              id: registrationId.trim(),
            },
          }
        );

      if (!registration) {
        return res.status(404).json({
          success: false,
          message:
            "Registration not found.",
        });
      }

      if (
        registration.status !==
        "RESERVED"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Only RESERVED registrations can be force-expired.",
          currentStatus:
            registration.status,
        });
      }

      await prisma.registration.update({
        where: {
          id: registration.id,
        },
        data: {
          expiresAt: new Date(
            Date.now() - 1000
          ),
        },
      });

      res.json({
        success: true,
        message:
          "Registration expiry time moved to the past for testing.",
        registrationId:
          registration.id,
      });
    } catch (error) {
      console.error(
        "Force expiry failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to force registration expiry.",
      });
    }
  }
);

// ========================================
// Manual expiry processing
// Development / testing endpoint
// ========================================
app.post(
  "/api/registrations/expire",
  async (req, res) => {
    try {
      const expiredCount =
        await expireReservations();

      res.json({
        success: true,
        message:
          "Expired reservations processed.",
        expiredCount,
      });
    } catch (error) {
      console.error(
        "Expiry processing failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to process expired reservations.",
      });
    }
  }
);

// ========================================
// Automatic expiry check
// Runs every minute
// ========================================
setInterval(async () => {
  try {
    const expiredCount =
      await expireReservations();

    if (expiredCount > 0) {
      console.log(
        `Automatically expired ${expiredCount} reservation(s).`
      );
    }
  } catch (error) {
    console.error(
      "Automatic expiry check failed:",
      error
    );
  }
}, 60 * 1000);

// ========================================
// Update registration status
// ========================================
// ORGANIZER:
//   RESERVED -> CONFIRMED
//   RESERVED -> CANCELLED
//   CONFIRMED -> CANCELLED
//
// CHECKIN STAFF:
//   CONFIRMED -> CHECKED_IN
//
// All status changes are authenticated and
// recorded in immutable registration history.
// ========================================
app.patch(
  "/api/registrations/:registrationId/status",
  authenticateToken,
  async (req, res) => {
    try {
      const { registrationId } = req.params;
      const { status, note } = req.body;

      if (!registrationId || registrationId.trim() === "") {
        return res.status(400).json({
          success: false,
          message: "Valid registration ID is required.",
        });
      }

      const allowedStatuses = [
        "RESERVED",
        "CONFIRMED",
        "CHECKED_IN",
        "CANCELLED",
        "EXPIRED",
      ];

      if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Valid registration status is required.",
          allowedStatuses,
        });
      }

      if (
        note !== undefined &&
        note !== null &&
        typeof note !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Note must be a string.",
        });
      }

      if (status === "EXPIRED") {
        return res.status(403).json({
          success: false,
          message:
            "EXPIRED status is managed automatically by the reservation expiry process.",
        });
      }

      const updatedRegistration = await prisma.$transaction(
        async (tx) => {
          const registration =
            await tx.registration.findUnique({
              where: {
                id: registrationId.trim(),
              },
              include: {
                session: {
                  include: {
                    event: true,
                  },
                },
              },
            });

          if (!registration) {
            const error = new Error("Registration not found.");
            error.code = "REGISTRATION_NOT_FOUND";
            throw error;
          }

          const oldStatus = registration.status;

          if (oldStatus === status) {
            const error = new Error(
              `Registration is already ${status}.`
            );
            error.code = "SAME_STATUS";
            throw error;
          }

          const organizerTransitions = {
            RESERVED: ["CONFIRMED", "CANCELLED"],
            CONFIRMED: ["CANCELLED"],
            CHECKED_IN: [],
            CANCELLED: [],
            EXPIRED: [],
          };

          const staffTransitions = {
            RESERVED: [],
            CONFIRMED: ["CHECKED_IN"],
            CHECKED_IN: [],
            CANCELLED: [],
            EXPIRED: [],
          };

          let allowedNextStatuses = [];

          if (req.user.role === "ORGANIZER") {
            allowedNextStatuses =
              organizerTransitions[oldStatus] || [];
          } else if (req.user.role === "CHECKIN_STAFF") {
            allowedNextStatuses =
              staffTransitions[oldStatus] || [];
          } else {
            const error = new Error(
              "Your account role is not allowed to update registration status."
            );
            error.code = "ROLE_NOT_ALLOWED";
            throw error;
          }

          // ----------------------------------------
          // CHECK-IN STAFF SESSION AUTHORIZATION
          //
          // A staff member may check in an attendee
          // only when that staff member is explicitly
          // assigned to the attendee's session.
          // ----------------------------------------
          if (
            status === "CHECKED_IN" &&
            req.user.role === "CHECKIN_STAFF"
          ) {
            const assignment =
              await tx.staffAssignment.findUnique({
                where: {
                  sessionId_userId: {
                    sessionId:
                      registration.sessionId,
                    userId: req.user.id,
                  },
                },
              });

            if (!assignment) {
              const error = new Error(
                "You are not assigned to this session and cannot check in this attendee."
              );

              error.code =
                "STAFF_NOT_ASSIGNED";

              error.sessionId =
                registration.sessionId;

              throw error;
            }
          }

          if (!allowedNextStatuses.includes(status)) {
            const error = new Error(
              `Invalid status transition: ${oldStatus} -> ${status}.`
            );
            error.code = "INVALID_STATUS_TRANSITION";
            error.oldStatus = oldStatus;
            error.newStatus = status;
            error.currentRole = req.user.role;
            error.allowedNextStatuses = allowedNextStatuses;
            throw error;
          }

          const timestampData = {};

          if (status === "CONFIRMED") {
            timestampData.confirmedAt = new Date();
          }

          if (status === "CHECKED_IN") {
            timestampData.checkedInAt = new Date();
          }

          if (status === "CANCELLED") {
            timestampData.cancelledAt = new Date();
          }

          const updated = await tx.registration.update({
            where: {
              id: registration.id,
            },
            data: {
              status,
              ...timestampData,
            },
          });

          await tx.registrationHistory.create({
            data: {
              registrationId: registration.id,
              actorId: req.user.id,
              action: "STATUS_CHANGED",
              oldStatus,
              newStatus: status,
              note:
                typeof note === "string" &&
                note.trim() !== ""
                  ? note.trim()
                  : `Status changed from ${oldStatus} to ${status}.`,
            },
          });

          return updated;
        }
      );

      return res.json({
        success: true,
        message:
          `Registration status changed to ${updatedRegistration.status}.`,
        registration: {
          id: updatedRegistration.id,
          sessionId: updatedRegistration.sessionId,
          name: updatedRegistration.name,
          email: updatedRegistration.email,
          status: updatedRegistration.status,
          reservedAt: updatedRegistration.reservedAt,
          expiresAt: updatedRegistration.expiresAt,
          confirmedAt: updatedRegistration.confirmedAt,
          checkedInAt: updatedRegistration.checkedInAt,
          cancelledAt: updatedRegistration.cancelledAt,
        },
        actor: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
        },
      });
    } catch (error) {
      console.error(
        "Registration status update failed:",
        error
      );

      if (error.code === "REGISTRATION_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Registration not found.",
        });
      }

      if (error.code === "SAME_STATUS") {
        return res.status(409).json({
          success: false,
          message: error.message,
        });
      }

      if (error.code === "INVALID_STATUS_TRANSITION") {
        return res.status(409).json({
          success: false,
          message: "Invalid status transition.",
          explanation: error.message,
          oldStatus: error.oldStatus,
          newStatus: error.newStatus,
          currentRole: error.currentRole,
          allowedNextStatuses:
            error.allowedNextStatuses,
        });
      }

      if (error.code === "STAFF_NOT_ASSIGNED") {
        return res.status(403).json({
          success: false,
          message: error.message,
          sessionId: error.sessionId,
          requiredRole: "CHECKIN_STAFF",
          requirement:
            "Staff member must be assigned to the session before checking in attendees.",
        });
      }

      if (error.code === "ROLE_NOT_ALLOWED") {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to update registration status.",
      });
    }
  }
);

// ========================================
// Get registration history
// ========================================
app.get(
  "/api/registrations/:registrationId/history",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        registrationId,
      } = req.params;

      if (
        !registrationId ||
        registrationId.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid registration ID is required.",
        });
      }

      const registration =
        await prisma.registration.findUnique(
          {
            where: {
              id: registrationId.trim(),
            },
          }
        );

      if (!registration) {
        return res.status(404).json({
          success: false,
          message:
            "Registration not found.",
        });
      }

      const history =
        await prisma.registrationHistory.findMany(
          {
            where: {
              registrationId:
                registration.id,
            },
            orderBy: {
              createdAt: "asc",
            },
            include: {
              actor: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                },
              },
            },
          }
        );

      res.json({
        success: true,
        registration: {
          id: registration.id,
          name: registration.name,
          email: registration.email,
          status: registration.status,
        },
        history,
      });
    } catch (error) {
      console.error(
        "Registration history fetch failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to fetch registration history.",
      });
    }
  }
);

// ========================================
// Start server
// ========================================
app.listen(PORT, () => {
  console.log(
    `Server running at http://localhost:${PORT}`
  );
});