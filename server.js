const express = require("express");
const cors = require("cors");
require("dotenv").config();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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
  host: "localhost",
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

// ========================================
// Authentication middleware
// ========================================
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
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
    // Verify that the user still exists
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
        message: "User account no longer exists.",
      });
    }

    // ----------------------------------------
    // Use current database role
    // ----------------------------------------
    req.user = user;

    next();
  } catch (error) {
    console.error("Authentication failed:", error.message);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
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

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
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
    message: "Event Registration API is running 🚀",
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
    const userCount = await prisma.user.count();

    res.json({
      success: true,
      database: "connected",
      userCount,
    });
  } catch (error) {
    console.error("Database test failed:", error);

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
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
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
        message: "Valid email is required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    const existingUser = await prisma.user.findUnique({
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

    const hashedPassword = await bcrypt.hash(
      password,
      12
    );

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role,
      },
    });

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Registration failed:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create account.",
    });
  }
});

// ========================================
// AUTH - Login
// ========================================
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

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

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
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
    console.error("Login failed:", error);

    res.status(500).json({
      success: false,
      message: "Failed to login.",
    });
  }
});

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
// RBAC - Organizer only test endpoint
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
// RBAC - Check-in staff only test endpoint
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
// Create test session
// DEVELOPMENT ONLY
// ========================================
app.post("/api/test-session", async (req, res) => {
  try {
    const event = await prisma.event.create({
      data: {
        name: "Test Event",
        description: "Development test event",
      },
    });

    const session = await prisma.session.create({
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
      message: "Test session created.",
      event: {
        id: event.id,
        name: event.name,
      },
      session: {
        id: session.id,
        title: session.title,
        capacity: session.capacity,
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
});

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

      if (!sessionId || !name || !email) {
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

      if (!emailRegex.test(email.trim())) {
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
              await tx.session.findUnique({
                where: {
                  id: sessionId.trim(),
                },
              });

            if (!session) {
              const error = new Error(
                "Session not found."
              );
              error.code =
                "SESSION_NOT_FOUND";
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
                  sessionId: session.id,
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
              const error = new Error(
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

            const reservedAt = new Date();

            const expiresAt = new Date(
              reservedAt.getTime() +
                15 * 60 * 1000
            );

            const newRegistration =
              await tx.registration.create({
                data: {
                  sessionId: session.id,
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
                  newStatus: "RESERVED",
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
          message: "Session not found.",
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
          capacity: error.capacity,
          occupied: error.occupied,
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

  for (const registration of expiredRegistrations) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const currentRegistration =
            await tx.registration.findUnique({
              where: {
                id: registration.id,
              },
            });

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
                oldStatus: "RESERVED",
                newStatus: "EXPIRED",
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
      const { registrationId } =
        req.params;

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
app.patch(
  "/api/registrations/:registrationId/status",
  async (req, res) => {
    try {
      const { registrationId } =
        req.params;
      const { status, note } = req.body;

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

      const allowedStatuses = [
        "RESERVED",
        "CONFIRMED",
        "CHECKED_IN",
        "CANCELLED",
        "EXPIRED",
      ];

      if (
        !status ||
        !allowedStatuses.includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid registration status is required.",
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

      const updatedRegistration =
        await prisma.$transaction(
          async (tx) => {
            const registration =
              await tx.registration.findUnique(
                {
                  where: {
                    id: registrationId.trim(),
                  },
                }
              );

            if (!registration) {
              const error = new Error(
                "Registration not found."
              );
              error.code =
                "REGISTRATION_NOT_FOUND";
              throw error;
            }

            const oldStatus =
              registration.status;

            if (oldStatus === status) {
              const error = new Error(
                `Registration is already ${status}.`
              );
              error.code =
                "SAME_STATUS";
              throw error;
            }

            const validTransitions = {
              RESERVED: [
                "CONFIRMED",
                "CANCELLED",
              ],
              CONFIRMED: [
                "CHECKED_IN",
                "CANCELLED",
              ],
              CHECKED_IN: [],
              CANCELLED: [],
              EXPIRED: [],
            };

            const allowedNextStatuses =
              validTransitions[
                oldStatus
              ] || [];

            if (
              !allowedNextStatuses.includes(
                status
              )
            ) {
              const error = new Error(
                `Invalid status transition: ${oldStatus} -> ${status}.`
              );

              error.code =
                "INVALID_STATUS_TRANSITION";
              error.oldStatus =
                oldStatus;
              error.newStatus = status;

              throw error;
            }

            const timestampData = {};

            if (status === "CONFIRMED") {
              timestampData.confirmedAt =
                new Date();
            }

            if (
              status === "CHECKED_IN"
            ) {
              timestampData.checkedInAt =
                new Date();
            }

            if (status === "CANCELLED") {
              timestampData.cancelledAt =
                new Date();
            }

            const updated =
              await tx.registration.update(
                {
                  where: {
                    id: registration.id,
                  },
                  data: {
                    status,
                    ...timestampData,
                  },
                }
              );

            await tx.registrationHistory.create(
              {
                data: {
                  registrationId:
                    registration.id,
                  actorId: null,
                  action:
                    "STATUS_CHANGED",
                  oldStatus,
                  newStatus: status,
                  note:
                    typeof note ===
                      "string" &&
                    note.trim() !== ""
                      ? note.trim()
                      : `Status changed from ${oldStatus} to ${status}.`,
                },
              }
            );

            return updated;
          }
        );

      res.json({
        success: true,
        message:
          `Registration status changed to ${updatedRegistration.status}.`,
        registration: {
          id: updatedRegistration.id,
          sessionId:
            updatedRegistration.sessionId,
          name:
            updatedRegistration.name,
          email:
            updatedRegistration.email,
          status:
            updatedRegistration.status,
          reservedAt:
            updatedRegistration.reservedAt,
          expiresAt:
            updatedRegistration.expiresAt,
          confirmedAt:
            updatedRegistration.confirmedAt,
          checkedInAt:
            updatedRegistration.checkedInAt,
          cancelledAt:
            updatedRegistration.cancelledAt,
        },
      });
    } catch (error) {
      console.error(
        "Registration status update failed:",
        error
      );

      if (
        error.code ===
        "REGISTRATION_NOT_FOUND"
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Registration not found.",
        });
      }

      if (
        error.code === "SAME_STATUS"
      ) {
        return res.status(409).json({
          success: false,
          message: error.message,
        });
      }

      if (
        error.code ===
        "INVALID_STATUS_TRANSITION"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Invalid status transition.",
          explanation:
            error.message,
          oldStatus:
            error.oldStatus,
          newStatus:
            error.newStatus,
        });
      }

      res.status(500).json({
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
  async (req, res) => {
    try {
      const { registrationId } =
        req.params;

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