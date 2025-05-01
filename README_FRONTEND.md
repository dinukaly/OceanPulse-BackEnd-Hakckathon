# 🌊 OceanPulse - Frontend

OceanPulse is a mobile application designed to improve the safety and awareness of fishermen by delivering real-time weather alerts, emergency broadcasting, user location tracking, and community engagement tools. This repository contains the frontend source code built with **React Native** and **Expo**.

## 🚀 Features

- 📍 Real-time GPS location tracking  
- 🌦️ Live weather alerts for fishermen  
- 🆘 Emergency broadcasting functionality  
- 👤 User registration, login, and profile management  
- 🔐 OTP verification and password reset system  
- ⚙️ Profile editing and update support  
- 💬 **Chat Feature**: Instant messaging between users for collaboration and support  
- 🧑‍🤝‍🧑 **Community Feature**:
  - 📢 Create and share public posts  
  - 💬 Add comments to posts  
  - ❤️ Like posts to show support  

## 🛠 Tech Stack

- **Framework**: React Native (Expo)
- **State Management**: React Context / useState
- **Navigation**: React Navigation
- **API Communication**: Axios
- **Backend**: Node.js + Express (see [OceanPulse Backend](https://github.com/yourusername/oceanpulse-backend))
- **Database**: MongoDB

## 📲 Getting Started

### Prerequisites

- Node.js & npm
- Expo CLI (`npm install -g expo-cli`)
- A physical device or emulator for testing

### Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/oceanpulse-frontend.git
cd oceanpulse-frontend
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
expo start
```

4. Run the app on your device using the Expo Go app (Android/iOS) or emulator.

### 📁 Folder Structure

```
src/
├── app/                # Screens and Views
├── components/         # Reusable UI components
├── context/            # Global state/context providers
├── services/           # API calls and external services
├── assets/             # Images and static resources
└── utils/              # Utility functions
```

## 🔐 Environment Variables

Create a `.env` file at the root with:

```env
API_URL=https://your-api-url.com
```

Use a package like `react-native-dotenv` or inline config where needed.

## 🧪 Testing

Basic testing can be done via Expo Go or emulator. Automated testing (optional) can be integrated using Jest or Detox.

## 📦 Deployment

To build a production APK or IPA:

```bash
eas build --platform android
eas build --platform ios
```

Make sure you're logged in to Expo and have configured `eas.json`.

## 🧑‍💻 Contributing

Contributions are welcome! Please fork the repo and open a pull request. For major changes, open an issue first.

## 📄 License

This project is licensed under the MIT License.

## 📬 Contact

- Developer: Dinuka
- Email: your-email@example.com
- Project: [OceanPulse Backend](https://github.com/yourusername/oceanpulse-backend)

---

Made with ❤️ for the safety and connection of our coastal communities.