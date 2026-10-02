# Матрица ролей и прав (RBAC)

Права хранятся в `permissions`, связываются с ролями в `role_permissions`.
Проверяются middleware `requirePermission` на каждом маршруте.

## Роли

| Код | Название | Приоритет |
|---|---|---|
| `patient` | Пациент | 10 |
| `doctor` | Врач | 20 |
| `head` | Зав. отделением | 30 |
| `chief` | Главный врач | 40 |
| `admin` | Администратор | 50 |

## Права по областям

### Пациенты
| Право | patient | doctor | head | chief | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| `patients.view.self` | ✅ | | | ✅ | |
| `patients.edit.self` | ✅ | | | ✅ | |
| `patients.view.department` | | ✅ | ✅ | ✅ | |
| `patients.view.all` | | | ✅ | ✅ | ✅ |
| `patients.create` | | ✅ | ✅ | ✅ | |
| `patients.edit.department` | | ✅ | ✅ | ✅ | |
| `patients.edit.all` | | | ✅ | ✅ | |

### Записи на приём
| Право | patient | doctor | head | chief | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| `appointments.view.self` | ✅ | | | ✅ | |
| `appointments.view.department` | | ✅ | ✅ | ✅ | |
| `appointments.view.all` | | | ✅ | ✅ | ✅ |
| `appointments.create.self` | ✅ | | | ✅ | |
| `appointments.create` | | ✅ | ✅ | ✅ | |
| `appointments.manage` | | ✅ | ✅ | ✅ | ✅ |

### Медкарты / анализы / назначения
| Право | patient | doctor | head | chief | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| `records.view.self` | ✅ | | | ✅ | |
| `records.view.department` | | ✅ | ✅ | ✅ | |
| `records.view.all` | | | ✅ | ✅ | |
| `records.create` | | ✅ | ✅ | ✅ | |
| `analyses.view.self` | ✅ | | | ✅ | |
| `analyses.view.department` | | ✅ | ✅ | ✅ | |
| `analyses.view.all` | | | ✅ | ✅ | |
| `analyses.order` / `analyses.enter` | | ✅ | ✅ | ✅ | |
| `prescriptions.*` | self | dept | dept+all | all | |
| `prescriptions.create` | | ✅ | ✅ | ✅ | |

### Статистика
| Право | patient | doctor | head | chief | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| `stats.patients.self` | ✅ | | | ✅ | |
| `stats.patients.department` | | ✅ | ✅ | ✅ | |
| `stats.patients.all` | | | ✅ | ✅ | ✅ |
| `stats.doctors.department` | | | ✅ | ✅ | |
| `stats.doctors.all` | | | ✅ | ✅ | ✅ |

### Администрирование
| Право | admin |
|---|:-:|
| `admin.users` | ✅ |
| `admin.roles` | ✅ |
| `admin.settings` | ✅ |
| `admin.audit` | ✅ |
| `departments.view` | все, кроме admin-only |
| `departments.manage` | head, chief, admin |
| `doctors.view.all` | patient, doctor, head, chief, admin |
| `doctors.manage` | chief, admin |

## Правило области видимости (scope)

Даже при наличии права, выборка ограничивается SQL-фильтром:

- **patient** → только свои строки (`patient_id = свой`);
- **doctor** → своё + отделение (`department_id = своё`);
- **head** → отделение;
- **chief** → вся клиника;
- **admin** → операционные данные без клинического содержимого.
