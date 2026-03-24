const nodemailer = require('nodemailer');

async function sendWithBrevo(to, subject, html) {
    const SibApiV3Sdk = require('sib-api-v3-sdk');
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKey = defaultClient.authentications['api-key'];
    apiKey.apiKey = process.env.BREVO_API_KEY;

    const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_USER;

    sendSmtpEmail.sender = { name: process.env.CAFE_NAME || 'Cafe Admin', email: senderEmail };
    sendSmtpEmail.to = [{ email: to }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
}

function sendWithGmail(to, subject, html) {
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: { rejectUnauthorized: false }
    });

    return transporter.sendMail({
        from: `${process.env.CAFE_NAME || 'Cafe Admin'} <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html
    });
}

async function sendEmail(to, subject, html) {
    if (process.env.BREVO_API_KEY) {
        console.log('Using Brevo API');
        await sendWithBrevo(to, subject, html);
    } else {
        console.log('Using Gmail SMTP');
        await sendWithGmail(to, subject, html);
    }
}

async function sendResetEmail(email, resetToken) {
    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/admin/reset-password?token=${resetToken}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f97316;">Password Reset Request</h2>
            <p>You requested to reset your password. Click the button below to reset it:</p>
            <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">Reset Password</a>
            <p>Or copy and paste this link in your browser:</p>
            <p style="color: #666; word-break: break-all;">${resetLink}</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 1 hour.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </div>
    `;

    try {
        await sendEmail(email, 'Password Reset Request', html);
        return { success: true };
    } catch (error) {
        console.error('Email send error:', error);
        return { success: false, error: error.message };
    }
}

async function sendVerificationEmail(email, verificationToken) {
    const inviteLink = `${process.env.APP_URL || 'http://localhost:3000'}/admin/register/${verificationToken}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f97316;">You're Invited to Join as Admin</h2>
            <p>You have been invited to join as an administrator. Click the button below to complete your registration:</p>
            <a href="${inviteLink}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">Complete Registration</a>
            <p>Or copy and paste this link in your browser:</p>
            <p style="color: #666; word-break: break-all;">${inviteLink}</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">After completing registration, your account will be pending approval from master admin.</p>
            <p style="color: #999; font-size: 12px;">If you didn't expect this invitation, please ignore this email.</p>
        </div>
    `;

    try {
        await sendEmail(email, 'Admin Invitation - Complete Your Registration', html);
        return { success: true };
    } catch (error) {
        console.error('Email send error:', error);
        return { success: false, error: error.message };
    }
}

module.exports = { sendResetEmail, sendVerificationEmail };
