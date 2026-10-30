import sgMail from '@sendgrid/mail';
import { config } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

export const requireEmailDelivery = () => {
  if (!config.sendgridApiKey || !config.sendgridFromEmail) {
    throw new AppError('Verification email is not configured', 503);
  }
};

export const sendVerificationEmail = async (email, code, purpose) => {
  requireEmailDelivery();
  sgMail.setApiKey(config.sendgridApiKey);
  try {
    await sgMail.send({
      to: email,
      from: config.sendgridFromEmail,
      subject: purpose === 'account' ? 'Verify your OceanPulse account' : 'Reset your OceanPulse password',
      text: `Your OceanPulse verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
    });
  } catch (error) {
    throw new AppError('Verification email could not be delivered', 503);
  }
};
