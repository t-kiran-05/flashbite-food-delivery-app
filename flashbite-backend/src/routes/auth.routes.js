// /**
//  * Auth Routes.
//  *
//  * POST /auth/register   � Create user with email+password+tenantId, returns JWT
//  * POST /auth/login      � Verify credentials, returns JWT
//  * GET  /auth/google     � Redirect to Google OAuth (optional SSO)
//  * GET  /auth/google/callback � Handle OAuth callback, return JWT
//  * GET  /auth/profile    � Protected: returns current user info from JWT
//  *
//  * Design notes:
//  *   - Merges legacy /routes/auth.js (Google OAuth + Passport) with skeleton auth.routes.js
//  *     (email/password with bcrypt + Mongoose User model)
//  *   - verifyJWT replaces passport.authenticate("jwt")
//  *   - Google OAuth uses passport-google-oauth20 Strategy (only strategy used with Passport)
//  *   - JWT is signed using jwtService.signToken() so secret is centralised
//  */
// "use strict";
// const express = require("express");
// const { body, validationResult } = require("express-validator");
// const bcrypt = require("bcrypt");
// const passport = require("passport");
// const { Strategy: GoogleStrategy } = require("passport-google-oauth20");

// const User = require("../models/user.model");
// const { signToken } = require("../services/jwtService");
// const { verifyJWT } = require("../middleware/auth");

// const router = express.Router();

// // ---------------------------------------------------------------------------
// // Google OAuth Strategy (passport minimal � only for OAuth callback)
// // ---------------------------------------------------------------------------
// if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== "your-google-client-id") {
//   passport.use(
//     new GoogleStrategy(
//       {
//         clientID: process.env.GOOGLE_CLIENT_ID,
//         clientSecret: process.env.GOOGLE_CLIENT_SECRET,
//         callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback",
//       },
//       async (accessToken, refreshToken, profile, done) => {
//         try {
//           // Find existing user by googleId or email
//           let user =
//             (await User.findOne({ googleId: profile.id })) ||
//             (await User.findOne({ email: profile.emails?.[0]?.value }));

//           if (!user) {
//             // New Google user � tenantId defaults to "default" until assigned
//             user = await User.create({
//               email: profile.emails?.[0]?.value,
//               googleId: profile.id,
//               role: "customer",
//               tenantId: "default",
//             });
//           }
//           return done(null, user);
//         } catch (err) {
//           return done(err);
//         }
//       }
//     )
//   );

//   passport.serializeUser((user, done) => done(null, user));
//   passport.deserializeUser((user, done) => done(null, user));
// }

// // ---------------------------------------------------------------------------
// // POST /auth/register
// // ---------------------------------------------------------------------------
// router.post(
//   "/register",
//   [
//     body("email").isEmail().withMessage("Valid email required"),
//     body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
//     body("tenantId").notEmpty().withMessage("tenantId is required"),
//   ],
//   async (req, res) => {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({ errors: errors.array() });
//     }

//     const { email, password, role, tenantId } = req.body;

//     try {
//       const existing = await User.findOne({ email });
//       if (existing) {
//         return res.status(409).json({ error: "Email already registered." });
//       }

//       const passwordHash = await bcrypt.hash(password, 10);
//       const user = await User.create({
//         email,
//         passwordHash,
//         role: role || "customer",
//         tenantId,
//       });

//       const token = signToken({
//         userId: user._id,
//         tenantId: user.tenantId,
//         role: user.role,
//       });

//       res.status(201).json({ token, user: { id: user._id, email: user.email, tenantId: user.tenantId, role: user.role } });
//     } catch (err) {
//       console.error("Register error:", err);
//       res.status(500).json({ error: "Registration failed." });
//     }
//   }
// );

// // ---------------------------------------------------------------------------
// // POST /auth/login
// // ---------------------------------------------------------------------------
// router.post(
//   "/login",
//   [
//     body("email").isEmail().withMessage("Valid email required"),
//     body("password").exists().withMessage("Password required"),
//   ],
//   async (req, res) => {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({ errors: errors.array() });
//     }

//     const { email, password } = req.body;

//     try {
//       const user = await User.findOne({ email });
//       if (!user) {
//         return res.status(401).json({ error: "Invalid credentials." });
//       }

//       const ok = await bcrypt.compare(password, user.passwordHash || "");
//       if (!ok) {
//         return res.status(401).json({ error: "Invalid credentials." });
//       }

//       const token = signToken({
//         userId: user._id,
//         tenantId: user.tenantId,
//         role: user.role,
//       });

//       res.json({ token, user: { id: user._id, email: user.email, tenantId: user.tenantId, role: user.role } });
//     } catch (err) {
//       console.error("Login error:", err);
//       res.status(500).json({ error: "Login failed." });
//     }
//   }
// );

// // ---------------------------------------------------------------------------
// // GET /auth/google � redirect to Google
// // ---------------------------------------------------------------------------
// router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// // ---------------------------------------------------------------------------
// // GET /auth/google/callback � handle OAuth callback
// // ---------------------------------------------------------------------------
// router.get(
//   "/google/callback",
//   passport.authenticate("google", { session: false, failureRedirect: "/" }),
//   (req, res) => {
//     const user = req.user;
//     const token = signToken({
//       userId: user._id,
//       tenantId: user.tenantId,
//       role: user.role,
//     });
//     // Redirect to frontend with token in query string (use secure flow in production)
//     const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
//     res.redirect(`${frontendOrigin}/?token=${token}`);
//   }
// );

// // ---------------------------------------------------------------------------
// // GET /auth/profile � protected
// // ---------------------------------------------------------------------------
// router.get("/profile", verifyJWT, (req, res) => {
//   res.json({ user: req.user });
// });

// module.exports = router;
const express = require("express");
const router = express.Router();
const passport = require("passport");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const User = require("../models/user.model");

// Rate limiter to mitigate brute-force attacks on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: { error: "Too many authentication attempts. Please try again after 15 minutes." },
});

// Helper: Generate JWT Token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    process.env.JWT_SECRET || "secret_key",
    { expiresIn: "1d" }
  );
};

// Helper: Set HttpOnly Cookie
const setAuthCookie = (res, token) => {
  res.cookie("token", token, {
    httpOnly: true, // Prevents client-side JS/XSS access
    secure: process.env.NODE_ENV === "production", // Transmit over HTTPS only in production
    sameSite: "strict", // Protection against CSRF
    maxAge: 24 * 60 * 60 * 1000, // 1 day expiry
  });
};

// Registration Route
router.post(
  "/register",
  authLimiter,
  [
    body("email").trim().isEmail().withMessage("Must be a valid email address"),
    body("tenantId").notEmpty().withMessage("tenantId is required"),
    body("password")
      .isLength({ min: 8, max: 32 }).withMessage("Password must be between 8 and 32 characters long")
      .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter")
      .matches(/[a-z]/).withMessage("Password must contain at least one lowercase letter")
      .matches(/[0-9]/).withMessage("Password must contain at least one number")
      .matches(/[@$!%*?&#]/).withMessage("Password must contain at least one special character (@$!%*?&#)"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, tenantId, role } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    try {
      // Scope lookup by both email AND tenantId
      let existingUser = await User.findOne({ email: normalizedEmail, tenantId });
      if (existingUser) {
        return res.status(400).json({ error: "User already exists for this tenant branch." });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Instantiated with passwordHash field
      const newUser = new User({
        email: normalizedEmail,
        passwordHash: hashedPassword,
        tenantId,
        role: role || "customer",
      });

      await newUser.save();

      const token = generateToken(newUser);
      setAuthCookie(res, token);

      return res.status(201).json({
        message: "User registered successfully",
        token, // Included for backward compatibility/headers
        user: { id: newUser._id, email: newUser.email, role: newUser.role, tenantId: newUser.tenantId },
      });
    } catch (err) {
      console.error("Registration error:", err);
      return res.status(500).json({ error: "Server error during registration" });
    }
  }
);

// Login Route
router.post(
  "/login",
  authLimiter,
  [
    body("email").trim().isEmail().withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required"),
    body("tenantId").notEmpty().withMessage("Tenant branch selection is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, tenantId } = req.body;

    try {
      const normalizedEmail = email.toLowerCase().trim();

      // Scoped find by email and tenantId
      const user = await User.findOne({ email: normalizedEmail, tenantId });

      if (!user) {
        return res.status(400).json({ error: "Invalid credentials for this merchant branch" });
      }

      if (!user.passwordHash) {
        return res.status(400).json({
          error: "This account was created using Google Sign-In. Please sign in with Google.",
        });
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ error: "Invalid credentials" });
      }

      const token = generateToken(user);
      setAuthCookie(res, token);

      return res.json({
        message: "Login successful",
        token,
        user: { id: user._id, email: user.email, role: user.role, tenantId: user.tenantId },
      });
    } catch (err) {
      console.error("Login error:", err);
      return res.status(500).json({ error: "Server error during login" });
    }
  }
);

// Logout Route
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  return res.json({ message: "Logged out successfully" });
});

// Google OAuth Trigger
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Google Callback Route
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/?action=login" }),
  (req, res) => {
    const token = generateToken(req.user);
    setAuthCookie(res, token);
    res.redirect(`/?token=${token}`);
  }
);

module.exports = router;