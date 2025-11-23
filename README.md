# stadvdb-mco2 <!-- omit from toc -->

<!-- ![title](./readme/title.jpg) -->

<!-- Refer to https://shields.io/badges for usage -->

![Year, Term, Course](https://img.shields.io/badge/AY2526--T1-STADVDB-blue)

![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=fff) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff) ![MySQL](https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=fff)

A web application that connects to a distributed database system which supports concurrent multi-user access. Created for STADVDB (Advanced Database Systems).

## Table of Contents <!-- omit from toc -->

- [1. Overview](#1-overview)
- [2. Getting Started](#2-getting-started)
  - [2.1. Prerequisites](#21-prerequisites)
  - [2.2. Building](#22-building)
  - [2.3. Running](#23-running)
- [Commands](#commands)

## 1. Overview

> [fill up]

## 2. Getting Started

### 2.1. Prerequisites

> [fill up]

### 2.2. Building

> [fill up]

### 2.3. Running

> [fill up]

## Commands

) Log in to MySQL locally (VM)

```bash
mysql -u root -p
```

) Create schema (VM) - refer to `schema.sql`

) Test local insertion (VM)

```bash
INSERT INTO Riders (courierName, vehicleType, firstName, lastName, gender, age, createdAt, updatedAt)
VALUES ('JNT','Motorcycle','Test','Rider','M',25,NOW(),NOW());

SELECT * FROM Riders;
```

) Test external connection (backend)

```bash
mysql -u root -p -h ccscloud.dlsu.edu.ph -P <external port for that node>
```

Password: (same as provided)

Ports

- Server0 → 60811
- Server1 → 60812
- Server2 → 60813

) Open MySQL config file

```bash
sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
```

) Restart SQL server

```bash
sudo systemctl restart mysql
```
