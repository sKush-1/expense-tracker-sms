# Project Specification: Local SMS-to-SQLite Android App

## 1. Project Overview

Build a lightweight, completely offline Android application using React Native Expo and TypeScript.

The application's only purpose is to:

1. Read previously received SMS messages from the Android inbox.
2. Automatically detect newly received SMS messages.
3. Store both historical and incoming messages in a local SQLite database.

This is an SMS collection and storage application, not an expense tracker yet. Do not implement transaction parsing, categorization, analytics, dashboards, or cloud synchronization.

## 2. Technology Stack

- React Native
- Expo with a custom development build
- TypeScript
- Kotlin for native Android SMS integration
- Expo Modules API for communication between Kotlin and TypeScript
- expo-sqlite for local database storage

Do not use Expo Go because native SMS functionality is required.

## 3. Core Functional Requirements

### A. SMS Permissions

- Request Android READ_SMS permission to access historical inbox messages.
- Request RECEIVE_SMS permission to detect incoming messages.
- Handle permission denial gracefully.
- Display the current permission status in the application.
- Do not attempt to bypass Android permission restrictions.

### B. Historical SMS Import

On application startup:

1. Check whether SMS permissions are granted.
2. Query the Android SMS Content Provider using ContentResolver.
3. Read messages from the inbox.
4. Extract:
   - Android SMS ID
   - Sender address
   - Message body
   - Received timestamp
   - Message type
5. Insert messages into SQLite.
6. Prevent duplicate records using the Android SMS ID.
7. Support importing large inboxes without blocking the UI.

The import operation must be incremental and idempotent. Reopening the application must not create duplicate messages.

### C. Incoming SMS Detection

Implement an Android BroadcastReceiver to detect new incoming SMS messages.

When an SMS arrives:

1. Extract the sender, message body and timestamp from the SMS broadcast.
2. Persist the message into the local SQLite database.
3. Prevent duplicate insertion.
4. Ensure the message can be stored even when the React Native JavaScript runtime is not active.
5. Handle multipart SMS messages correctly.
6. Handle process recreation and application backgrounding safely.

Do not rely on an in-memory JavaScript listener or static callback for background persistence.

### D. Local SQLite Database

Use expo-sqlite for database initialization and application-level database access.

Create the following table:

```sql
CREATE TABLE IF NOT EXISTS sms_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    android_sms_id TEXT UNIQUE,
    sender TEXT NOT NULL,
    message TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    message_type TEXT DEFAULT 'inbox',
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

Requirements:

- Initialize the database automatically.
- Use parameterized queries.
- Add appropriate indexes for sender and received_at.
- Handle database initialization and migration safely.
- Prevent duplicate SMS records.
- Keep timestamps in Unix milliseconds when received from Android.
- Ensure native incoming-message persistence and TypeScript database access use the same database file.

### E. Synchronization Between Native Android and SQLite

The native Kotlin receiver and Expo application must write to the same SQLite database.

Choose a reliable architecture for this.

Avoid maintaining separate native and JavaScript databases or implementing unnecessary synchronization mechanisms.

Document how database initialization, native database access, transactions and concurrent writes are handled.

If direct shared SQLite access introduces unnecessary complexity, propose a minimal reliable alternative that still guarantees incoming SMS persistence while the JavaScript runtime is inactive.

## 4. Application Interface

Keep the UI minimal.

The main screen should display:

- Total stored SMS count.
- SMS permission status.
- Import status.
- Latest received messages.
- Sender.
- Message preview.
- Received date and time.

Provide:

- A button to import historical SMS manually.
- A button to refresh the message list.
- Basic error and permission-denied states.

No elaborate UI or dashboard is required.

## 5. Suggested Project Structure

```text
sms-local/
├── app/
│   ├── _layout.tsx
│   └── index.tsx
│
├── src/
│   ├── database/
│   │   ├── db.ts
│   │   ├── schema.ts
│   │   └── sms.repository.ts
│   │
│   ├── sms/
│   │   ├── sms-reader.ts
│   │   └── sms-importer.ts
│   │
│   └── types/
│       └── sms.ts
│
├── modules/
│   └── sms-reader/
│       ├── index.ts
│       ├── expo-module.config.json
│       └── android/
│           └── src/main/
│               ├── AndroidManifest.xml
│               └── java/com/app/sms/
│                   ├── SmsReaderModule.kt
│                   ├── SmsReceiver.kt
│                   └── SmsDatabaseHelper.kt
│
├── app.json
├── package.json
└── tsconfig.json
```

You may adjust this structure if Expo Modules API conventions require it, but keep native SMS functionality isolated from application logic.

## 6. Technical Constraints

- Android only for the initial version.
- Fully offline operation.
- No backend.
- No HTTP requests.
- No cloud services.
- No authentication.
- No external database.
- No SMS parsing or transaction extraction.
- No unnecessary dependencies.
- No dependency on Google Messages APIs.
- Use Android's native SMS Content Provider and BroadcastReceiver.
- Keep the implementation compatible with the selected Expo SDK and Android target.

## 7. Reliability and Data Integrity

- Historical imports must be safe to repeat.
- Incoming messages must not be lost merely because the app is closed or its JavaScript runtime is inactive.
- Handle duplicate SMS broadcasts.
- Handle multipart messages.
- Handle database write failures.
- Handle missing or unavailable SMS permissions.
- Do not store OTPs or filter message content in this initial version; the goal is to store inbox SMS as requested.
- Keep the database inside the app's private storage.
- Document backup and uninstall implications.

## 8. Development Phases

Implement the project incrementally.

### Phase 1: Project Setup

- Initialize Expo project.
- Configure native Android development build.
- Install expo-sqlite.
- Initialize SQLite schema.
- Verify database reads and writes.

### Phase 2: Historical SMS Reading

- Implement native SMS Content Provider integration.
- Request READ_SMS permission.
- Import existing inbox messages.
- Verify duplicate prevention.

### Phase 3: Incoming SMS Detection

- Implement BroadcastReceiver.
- Request RECEIVE_SMS permission.
- Persist incoming SMS while the application is backgrounded or terminated.
- Verify multipart handling and duplicate prevention.

### Phase 4: UI and Integration

- Display stored messages.
- Add manual import and refresh functionality.
- Display permission and import status.

### Phase 5: Testing and Documentation

- Test on a physical Android device.
- Test with the application open, backgrounded and terminated.
- Test with existing and newly received SMS.
- Test duplicate imports.
- Test permission denial and subsequent permission granting.
- Document build, installation, permissions and troubleshooting.

## 9. Expected Deliverables

1. Complete Expo TypeScript project.
2. Native Kotlin SMS module.
3. Local SQLite implementation.
4. Minimal working UI.
5. Android development build instructions.
6. README documenting architecture and setup.
7. Testing instructions and known Android limitations.

## 10. Important Implementation Instructions

Before coding, inspect the installed Expo SDK and current Expo Modules API conventions.

Do not invent native module APIs or use outdated Android SMS receiver implementations.

First explain the proposed native-to-SQLite persistence architecture, especially how the receiver writes messages when JavaScript is not running.

Then implement the project phase by phase.

Do not claim that SMS detection works until it has been tested on a physical Android device.

Prioritize correctness, minimal complexity, offline operation and reliable message persistence over architectural sophistication.
