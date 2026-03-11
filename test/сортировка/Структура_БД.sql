-- Структура базы данных «Цифровой документооборот»
-- ООО «АльфаТех», версия 2.1
-- Дата создания: 2026-01-15

CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    head_id     INTEGER,
    created_at  TIMESTAMP DEFAULT NOW()
);

INSERT INTO departments (name) VALUES
    ('IT-отдел'),
    ('Бухгалтерия'),
    ('Отдел продаж'),
    ('Юридический отдел'),
    ('Отдел кадров');

CREATE TABLE employees (
    id              SERIAL PRIMARY KEY,
    full_name       VARCHAR(300) NOT NULL,
    email           VARCHAR(200) UNIQUE NOT NULL,
    department_id   INTEGER REFERENCES departments(id),
    position        VARCHAR(200),
    salary          DECIMAL(12, 2),
    hired_at        DATE NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE
);

INSERT INTO employees (full_name, email, department_id, position, salary, hired_at) VALUES
    ('Иванов Алексей Петрович', 'ivanov@alfatech.ru', 1, 'Ведущий разработчик', 180000.00, '2024-03-15'),
    ('Петрова Мария Сергеевна', 'petrova@alfatech.ru', 1, 'UI/UX дизайнер', 140000.00, '2024-06-01'),
    ('Сидоров Константин', 'sidorov@alfatech.ru', 3, 'Менеджер по продажам', 120000.00, '2025-01-10'),
    ('Козлова Елена', 'kozlova@alfatech.ru', 2, 'Главный бухгалтер', 160000.00, '2023-09-01');

CREATE TABLE documents (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(500) NOT NULL,
    doc_type        VARCHAR(50) NOT NULL,
    author_id       INTEGER REFERENCES employees(id),
    department_id   INTEGER REFERENCES departments(id),
    content         TEXT,
    status          VARCHAR(20) DEFAULT 'draft',
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_documents_type ON documents(doc_type);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_author ON documents(author_id);

-- Представление: документы с авторами
CREATE VIEW v_documents_full AS
SELECT
    d.id, d.title, d.doc_type, d.status,
    e.full_name AS author_name,
    dep.name AS department_name,
    d.created_at
FROM documents d
LEFT JOIN employees e ON d.author_id = e.id
LEFT JOIN departments dep ON d.department_id = dep.id;
