-- CREATE DATABASE (if not exists)
CREATE DATABASE IF NOT EXISTS ridersdb;
USE ridersdb;

-- Riders table (same schema for all nodes)
CREATE TABLE IF NOT EXISTS Riders (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  courierName ENUM('JNT', 'LBCD', 'FEDEZ') NOT NULL,
  vehicleType ENUM('Motorcycle', 'Bicycle', 'Tricycle', 'Car') NOT NULL,
  firstName VARCHAR(50) NOT NULL,
  lastName VARCHAR(50) NOT NULL,
  gender VARCHAR(10) NOT NULL,
  age INT,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Logs table (identical schema for all nodes)
CREATE TABLE IF NOT EXISTS Logs (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tx_id VARCHAR(50) NOT NULL,
  node_name ENUM('node1','node2','node3') NOT NULL,
  action ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  rider_id INT NOT NULL,
  old_value JSON DEFAULT NULL,
  new_value JSON DEFAULT NULL,
  status ENUM('pending','replicated') DEFAULT 'pending',
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Optional indexes for faster replication queries
CREATE INDEX idx_logs_rider_id ON Logs(rider_id);
CREATE INDEX idx_logs_status ON Logs(status);
CREATE INDEX idx_logs_timestamp ON Logs(timestamp);
