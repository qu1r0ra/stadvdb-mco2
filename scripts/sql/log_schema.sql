Logs (
  id INT AUTO_INCREMENT,
  tx_id VARCHAR(50),
  node_name ENUM('node1', 'node2', 'node3'),
  action ENUM('INSERT', 'UPDATE', 'DELETE'),
  rider_id INT,
  old_value JSON,
  new_value JSON,
  timestamp DATETIME
)
