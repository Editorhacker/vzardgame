const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const Registration = require('./models/registration');
const app = express();

// MongoDB Connection
mongoose.connect('mongodb+srv://adi:adi@vzard.eyygl.mongodb.net/bgmi_tournament', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB successfully');
}).catch((err) => {
    console.error('MongoDB connection error:', err);
});

// Enable CORS
app.use(cors());

// Middleware for parsing form data
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Session middleware for admin authentication
const session = require('express-session');
app.use(session({
    secret: 'bgmi-tournament-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // set to true if using https
}));

// Admin authentication middleware
function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
}

// Serve static files
app.use(express.static(path.join(__dirname)));

// Admin routes
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin/login.html'));
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    // Simple authentication
    if (username === 'Admin' && password === 'admin') {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Invalid credentials' });
    }
});

app.get('/admin/dashboard', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin/dashboard.html'));
});

app.get('/admin/registrations', requireAdmin, async (req, res) => {
    try {
        const registrations = await Registration.find().sort('-createdAt');
        res.json({ success: true, registrations });
    } catch (error) {
        console.error('Error fetching registrations:', error);
        res.status(500).json({ success: false, message: 'Error fetching registrations' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Route for the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route for the registration page
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

// Handle registration form submission
app.post('/register', async (req, res) => {
    try {
        const formData = req.body;
        console.log('Received registration data:', JSON.stringify(formData, 2));
        
        // Basic validation
        if (!formData.teamName || !formData.teamEmail || !formData.teamPhone) {
            console.log('Missing required fields:', { teamName: formData.teamName, teamEmail: formData.teamEmail, teamPhone: formData.teamPhone });
            return res.status(400).json({
                success: false,
                message: 'Please fill in all required fields.'
            });
        }

        // Email validation
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(formData.teamEmail)) {
            console.log('Invalid email:', formData.teamEmail);
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address.'
            });
        }

        // Phone validation
        const phoneRegex = /^\d{10}$/;
        if (!phoneRegex.test(formData.teamPhone)) {
            console.log('Invalid phone:', formData.teamPhone);
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid 10-digit phone number.'
            });
        }

        // Create new registration document
        console.log('Creating registration document...');
        const registration = new Registration(formData);
        
        // Validate the document before saving
        const validationError = registration.validateSync();
        if (validationError) {
            console.error('Validation error:', validationError);
            return res.status(400).json({
                success: false,
                message: 'Invalid registration data. Please check all fields.'
            });
        }

        // Save the document
        await registration.save();
        console.log('Registration saved successfully:', registration._id);
        
        res.json({
            success: true,
            message: 'Registration successful! We will contact you with further details.'
        });
    } catch (error) {
        console.error('Registration error:', error);
        // Send more specific error message
        let errorMessage = 'Registration failed. Please try again.';
        if (error.name === 'ValidationError') {
            errorMessage = 'Please check all required fields are filled correctly.';
        } else if (error.name === 'MongoError' && error.code === 11000) {
            errorMessage = 'This team is already registered.';
        }
        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
});

// Twilio Configuration
const twilio = require('twilio');
const twilioClient = twilio('ACa0e3436a49797b3e4aa5a5b5e941f6fc', '3c6e98003fc56ad91347b86893b6b59b');
const verificationCodes = new Map();

// Generate OTP endpoint
app.post('/api/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        console.log('Received phone number:', phone);
        
        const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit OTP
        console.log('Generated OTP:', otp);
        
        console.log('Attempting to send SMS with Twilio...');
        const messageResponse = await twilioClient.messages.create({
            body: `Your VZard Game registration OTP is: ${otp}`,
            to: `+91${phone}`, // Add India country code
            from: '+18312822966'
        });
        
        console.log('Twilio response:', messageResponse.sid);

        verificationCodes.set(phone, {
            code: otp.toString(),
            timestamp: Date.now()
        });

        res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            status: error.status,
            moreInfo: error.moreInfo
        });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send OTP',
            error: error.message
        });
    }
});

// Verify OTP endpoint
app.post('/api/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    console.log('Verifying OTP:', { phone, otp });
    const storedData = verificationCodes.get(phone);
    console.log('Stored OTP data:', storedData);

    if (!storedData) {
        return res.json({ success: false, message: 'No OTP found for this number' });
    }

    // Check if OTP is expired (5 minutes validity)
    if (Date.now() - storedData.timestamp > 5 * 60 * 1000) {
        verificationCodes.delete(phone);
        return res.json({ success: false, message: 'OTP has expired' });
    }

    if (storedData.code === otp) {
        verificationCodes.delete(phone);
        return res.json({ 
            success: true, 
            message: 'Phone number verified successfully',
            verified: true
        });
    }

    res.json({ 
        success: false, 
        message: 'Invalid OTP. Please try again.',
        verified: false
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong! Please try again later.'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
