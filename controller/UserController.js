import User from "../model/UserSchema.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { successResponse } from "../utils/responseHandler.js";
import { AppError } from "../middleware/errorHandler.js";
import { config } from "../config/env.js";

const generateOtp = () => Math.floor(10000 + Math.random() * 90000);

const generateUsername = (firstName, lastName) => {
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomDigits}`;
};

// Helper to create consistent user response object
const formatUserResponse = (user) => ({
  userId: user._id,
  username: user.username,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  isActive: user.isActive,
});

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, username: user.username },
    config.jwtSecret,
    { expiresIn: "90d" }
  );
};

// Generate reset token with short expiration
const generateResetToken = (user) => {
  return jwt.sign(
    { userId: user._id, email: user.email, purpose: "reset-password" },
    config.jwtSecret,
    { expiresIn: "1h" }
  );
};

const registerUser = async (req, res, next) => {
  try {
    const { firstName, lastName, email, boatId, contact, password } = req.body;

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      throw new AppError("Email already exists", 400);
    }

    const username = generateUsername(firstName, lastName);
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      throw new AppError("Username already exists", 400);
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    const otp = generateOtp();
    console.log(`Generated OTP: ${otp}`);

    const newUser = new User({
      username,
      firstName,
      lastName,
      email,
      contact,
      otp: otp.toString(),
      password: hashedPassword,
      boatId,
      isActive: false,
    });

    await newUser.save();

    // Generate token after registration
    const token = generateToken(newUser);

    successResponse(
      res,
      {
        message: "User registered successfully, please verify OTP",
        user: formatUserResponse(newUser),
        token,
        otp, // In production, remove OTP from response and send via email
      },
      201
    );
  } catch (error) {
    next(error);
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const { username, otp } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.otp !== otp.toString()) {
      throw new AppError("Invalid OTP", 400);
    }

    user.isActive = true;
    await user.save();

    // Generate new token after OTP verification
    const token = generateToken(user);

    successResponse(res, {
      message: "OTP verified successfully. User account is now active.",
      token,
      user: formatUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
};

const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      throw new AppError("Email and OTP are required", 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.otp !== otp.toString()) {
      throw new AppError("Invalid OTP", 400);
    }

    // Generate a special short-lived token for password reset
    const resetToken = generateResetToken(user);

    // Clear the OTP after successful verification
    user.otp = "";
    await user.save();

    successResponse(res, {
      message: "OTP verified successfully. You can now reset your password.",
      success: true,
      resetToken,
      email: user.email,
    });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { email, password, resetToken } = req.body;

    if (!email || !password || !resetToken) {
      throw new AppError("Email, password and reset token are required", 400);
    }

    // Verify reset token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, config.jwtSecret);
    } catch (error) {
      throw new AppError("Invalid or expired reset token", 401);
    }

    // Check if token is for password reset and matches the email
    if (decoded.purpose !== "reset-password" || decoded.email !== email) {
      throw new AppError("Invalid reset token", 401);
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User not found", 404);
    }

    // Update password
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);
    user.password = hashedPassword;
    await user.save();

    successResponse(res, {
      message: "Password reset successfully",
      success: true,
    });
  } catch (error) {
    next(error);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User not found", 404);
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      throw new AppError("Invalid password", 401);
    }

    const token = generateToken(user);

    successResponse(res, {
      message: "Login successful",
      token,
      user: formatUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError("Email is required", 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User with this email does not exist", 404);
    }

    const newOtp = generateOtp();
    user.otp = newOtp.toString();
    await user.save();

    console.log(`Forgot Password OTP for ${email}: ${newOtp}`);

    successResponse(res, {
      message: "OTP sent to your email",
      otp: newOtp, // i n production, send this OTP via email because sendgrid not work as expected
    });
  } catch (error) {
    next(error);
  }
};

const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    successResponse(res, {
      user: formatUserResponse(user),
    });
  } catch (error) {
    next(error);
  }
};
const updateUserProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, contact, language, boatId } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.contact = contact || user.contact;
    user.language = language || user.language;
    user.boatId = boatId || user.boatId;

    await user.save();

    successResponse(res, {
      message: "Profile updated successfully",
      user: {
        userId: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        contact: user.contact,
        language: user.language,
        boatId: user.boatId,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    next(error);
  }
};

const fetchUsers = async (req, res, next) => {
  try {
    const users = await User.find(
      { _id: { $ne: req.user.userId } },
      "firstName lastName email username _id isActive"
    );

    const formattedUsers = users.map((user) => formatUserResponse(user));

    successResponse(res, formattedUsers);
  } catch (error) {
    next(error);
  }
};

export default {
  registerUser,
  verifyOtp,
  verifyResetOtp,
  resetPassword,
  loginUser,
  fetchUsers,
  forgotPassword,
  getUserProfile,
  updateUserProfile,
};
