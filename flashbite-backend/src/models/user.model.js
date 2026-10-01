// /**
//  * User Mongoose model.
//  * tenantId scopes users to a specific tenant (restaurant brand / operator).
//  * Supports both password-based auth and Google SSO (googleId).
//  */
// "use strict";
// const mongoose = require("mongoose");

// const UserSchema = new mongoose.Schema(
//   {
//     email: { type: String, required: true, unique: true, trim: true, lowercase: true },
//     passwordHash: { type: String, default: null },
//     role: {
//       type: String,
//       enum: ["customer", "restaurant", "admin"],
//       default: "customer",
//     },
//     /** tenantId links this user to a specific tenant / organisation. */
//     tenantId: { type: String, required: true, index: true },
//     /** Populated when the user registers via Google OAuth. */
//     googleId: { type: String, default: null, sparse: true },
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("User", UserSchema);

"use strict";
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, default: null },
    role: {
      type: String,
      enum: ["customer", "restaurant", "admin"],
      default: "customer",
    },
    /** tenantId links this user to a specific tenant / organization. */
    tenantId: { type: String, required: true, index: true },
    /** Populated when the user registers via Google OAuth. */
    googleId: { type: String, default: null, sparse: true },
  },
  { timestamps: true }
);

// Compound unique index: Email is unique PER tenant
UserSchema.index({ email: 1, tenantId: 1 }, { unique: true });

module.exports = mongoose.model("User", UserSchema);