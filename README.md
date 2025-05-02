# 🌊 OceanPulse - Backend

This is the backend server for **OceanPulse**, a mobile application that enhances the safety and communication of fishermen at sea. The backend is built with **Node.js**, **Express**, and **MongoDB**, following the **MVC (Model-View-Controller)** architecture to ensure scalability and maintainability.

## 🚀 Features

- 👤 User Authentication & Authorization  
  - User registration, login, and logout  
  - OTP-based account verification  
  - Password reset flow  
- 📄 Profile Management  
  - View and update user profile information  
- 🆘 Emergency Broadcast System  
  - Fishermen can send emergency alerts to authorities or other users  
- 🌦️ Real-time Weather Alerts  
  - Server pushes location-based weather alerts to users  
- 📍 Location Sharing  
  - Users share their real-time GPS location  
- 💬 **Chat System**  
  - Real-time messaging using WebSocket (Socket.io)  
- 🧑‍🤝‍🧑 **Community Forum**  
  - Create public posts, comment, and like  

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB + Mongoose
- **Authentication**: JWT + OTP
- **Real-Time Communication**: Socket.io
- **Architecture**: MVC (Model-View-Controller)
- **Environment Management**: dotenv
- **Validation**: express-validator

## 📁 Folder Structure

```
src/
├── controllers/    # Route handlers / business logic
├── models/         # Mongoose data models
├── routes/         # Express route definitions
├── middleware/     # Custom middleware (auth, error handling)
├── services/       # External API calls (weather, etc.)
├── utils/          # Utility functions
└── config/         # Database and app configuration
```

## 📲 Getting Started

### Prerequisites

- Node.js & npm
- MongoDB (local or Atlas)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/oceanpulse-backend.git
cd oceanpulse-backend
```

2. Install dependencies:

```bash
npm install
```

3. Set environment variables in a `.env` file:

```env
PORT=5000
MONGO_URI=your-mongodb-connection-string
JWT_SECRET=your-jwt-secret
```

4. Run the server:

```bash
npm start
```

## 🧪 Testing

You can test endpoints using Postman or Swagger.

## 📦 Deployment

You can deploy the app on Render, Railway, Heroku, or a VPS. Ensure environment variables are set and MongoDB is accessible.

## 🧑‍💻 Contributing

Contributions are welcome. Please fork the repo and open a PR. For significant changes, open an issue for discussion first.

## 📄 License

This project is licensed under the MIT License.

## 📬 Contact

- Developer: Dinuka
- Email: infodinukalk@gmail.com
- Project: [OceanPulse Frontend](https://github.com/yourusername/oceanpulse-frontend)

---

Made with ❤️ to protect lives at sea.
