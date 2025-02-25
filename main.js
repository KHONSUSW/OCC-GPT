const lark = require("@larksuiteoapi/node-sdk");
const express = require("express");

const LARK_APP_ID = process.env.APPID || "";
const LARK_APP_SECRET = process.env.SECRET || "";
const PORT = process.env.PORT || 3000;

const client = new lark.Client({
  appId: LARK_APP_ID,
  appSecret: LARK_APP_SECRET,
  disableTokenCache: false,
  domain: lark.Domain.Lark,
});

const app = express();
app.use(express.json());

// Глобальные переменные для хранения данных
let responsibleEmployees = { day: [], night: [] }; // Ответственные за запросы
let shiftSchedule = {}; // График смен
let tasks = []; // Задачи
let adminUsers = ["e5cfg8f8"]; // Админы
let requests = []; // Запросы
let approvals = []; // Запросы на апрув
let reminders = []; // Напоминания
let weeklyResponsibleRotation = { 
  startDate: new Date().toISOString().split('T')[0], 
  dayTeam: [],
  nightTeam: []
}; // Еженедельная ротация ответственных

// Логирование
function logger(...params) {
  console.error("[CF]", ...params);
}

// Отправка сообщения
async function reply(messageId, content, buttons = []) {
  try {
    const messageContent = {
      text: content,
    };

    if (buttons.length > 0) {
      messageContent.buttons = buttons;
    }

    return await client.im.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(messageContent),
        msg_type: "text",
      },
    });
  } catch (e) {
    logger("send message to Lark error", e, messageId, content);
  }
}

// Команда /help
async function cmdHelp(messageId) {
  const helpText = `Доступные команды:\n\n/help - показать это сообщение\n/смена - узнать, кто сейчас на смене\n/ответственные - узнать ответственных за запросы\n/запрос - отправить запрос\n/помощник - получить справочную информацию\n/задача - отправить задачу\n/admin - админские функции\n/напоминание - создать напоминание`;
  await reply(messageId, helpText);
}

// Функция для проверки и обновления еженедельных ответственных
function updateWeeklyResponsible() {
  const today = new Date();
  const startDate = new Date(weeklyResponsibleRotation.startDate);
  const daysDiff = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
  
  // Если прошло 7 или более дней с момента последнего обновления
  if (daysDiff >= 7) {
    // Обновляем дату начала новой недели
    weeklyResponsibleRotation.startDate = today.toISOString().split('T')[0];
    
    // Ротация ответственных (перемещаем первого в конец)
    if (weeklyResponsibleRotation.dayTeam.length > 0) {
      const first = weeklyResponsibleRotation.dayTeam.shift();
      weeklyResponsibleRotation.dayTeam.push(first);
    }
    
    if (weeklyResponsibleRotation.nightTeam.length > 0) {
      const first = weeklyResponsibleRotation.nightTeam.shift();
      weeklyResponsibleRotation.nightTeam.push(first);
    }
    
    // Обновляем основной список ответственных
    responsibleEmployees.day = weeklyResponsibleRotation.dayTeam.slice(0, 2);
    responsibleEmployees.night = weeklyResponsibleRotation.nightTeam.slice(0, 2);
    
    logger("Weekly rotation updated", responsibleEmployees);
  }
}

// Команда /смена
async function cmdSmena(messageId) {
  const today = new Date().toISOString().split('T')[0];
  const shift = shiftSchedule[today] || { day: ["Нет данных"], night: ["Нет данных"] };
  await reply(messageId, `Сейчас на смене:\nДневная: ${shift.day.join(', ')}\nНочная: ${shift.night.join(', ')}`);
}

// Команда /ответственные
async function cmdResponsible(messageId) {
  // Проверяем необходимость обновления ответственных
  updateWeeklyResponsible();
  
  const nextRotationDate = new Date(weeklyResponsibleRotation.startDate);
  nextRotationDate.setDate(nextRotationDate.getDate() + 7);
  
  await reply(messageId, `Ответственные за запросы (до ${nextRotationDate.toISOString().split('T')[0]}):\nДневная: ${responsibleEmployees.day.join(', ')}\nНочная: ${responsibleEmployees.night.join(', ')}`);
}

// Команда /запрос
async function cmdRequest(messageId, userId, text) {
  // Извлекаем текст запроса, удаляя команду
  const requestText = text.replace("/запрос", "").trim();
  if (!requestText) {
    await reply(messageId, "Пожалуйста, укажите текст запроса. Пример: /запрос Нужна помощь с оформлением документов.");
    return;
  }
  
  const request = { 
    id: requests.length + 1, 
    userId, 
    text: requestText, 
    status: 'В обработке', 
    createdAt: new Date().toISOString(),
    assignedTo: null,
    comments: []
  };
  requests.push(request);

  // Проверяем и обновляем ответственных перед отправкой
  updateWeeklyResponsible();

  // Определяем ответственных в зависимости от времени
  const responsible = getResponsible();
  
  // Уведомляем всех ответственных за текущую смену
  for (const respId of responsible.ids) {
    await client.im.message.create({
      data: {
        receive_id: respId,
        content: JSON.stringify({
          text: `Новый запрос #${request.id} от пользователя ${userId}:\n${requestText}`,
          buttons: [
            { text: "Взял в работу", value: `take_${request.id}` },
          ]
        }),
        msg_type: "text",
      },
    });
  }

  await reply(messageId, `Ваш запрос #${request.id} принят в обработку. Вы получите уведомление о ходе выполнения.`);
}

// Команда /помощник
async function cmdHelper(messageId) {
  const helpText = `Помощник:\n\nКомиссии: [ссылка]\nМинималки: [ссылка]\n\nЧасто задаваемые вопросы:\n- Как оформить возврат? [ссылка]\n- Где найти шаблоны документов? [ссылка]\n- Порядок работы с претензиями [ссылка]`;
  await reply(messageId, helpText);
}

// Команда /задача
async function cmdTask(messageId, userId, text) {
  // Извлекаем текст задачи и получателя
  const taskContent = text.replace("/задача", "").trim();
  const parts = taskContent.split(' для ');
  
  if (parts.length < 2) {
    await reply(messageId, "Пожалуйста, укажите задачу и получателя. Пример: /задача Подготовить отчет для @Иван");
    return;
  }
  
  const taskText = parts[0].trim();
  const assigneeTag = parts[1].trim();
  const assigneeId = assigneeTag.startsWith('@') ? assigneeTag.substring(1) : assigneeTag;
  
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 1); // Пример: срок выполнения - завтра
  
  const task = { 
    id: tasks.length + 1, 
    creatorId: userId, 
    assigneeId, 
    text: taskText, 
    status: 'Назначена', 
    createdAt: new Date().toISOString(),
    deadline: deadline.toISOString(),
    comments: []
  };
  tasks.push(task);

  // Уведомление сотруднику
  await client.im.message.create({
    data: {
      receive_id: assigneeId,
      content: JSON.stringify({
        text: `Новая задача #${task.id} от руководителя:\n${taskText}\nСрок выполнения: ${deadline.toLocaleDateString()}`,
        buttons: [
          { text: "Готово", value: `complete_${task.id}` },
          { text: "Вопрос", value: `question_${task.id}` },
        ]
      }),
      msg_type: "text",
    },
  });

  await reply(messageId, `Задача #${task.id} отправлена сотруднику ${assigneeId}. Срок: ${deadline.toLocaleDateString()}.`);
}

// Команда /напоминание
async function cmdReminder(messageId, userId, text) {
  const reminderText = text.replace("/напоминание", "").trim();
  const parts = reminderText.split(' в ');
  
  if (parts.length < 2) {
    await reply(messageId, "Пожалуйста, укажите текст напоминания и время. Пример: /напоминание Позвонить клиенту в 15:00");
    return;
  }
  
  const content = parts[0].trim();
  const timeStr = parts[1].trim();
  
  // Парсим время
  const now = new Date();
  const [hours, minutes] = timeStr.split(':').map(Number);
  const reminderTime = new Date(now);
  reminderTime.setHours(hours, minutes || 0, 0);
  
  // Если время уже прошло, ставим на завтра
  if (reminderTime < now) {
    reminderTime.setDate(reminderTime.getDate() + 1);
  }
  
  const reminder = {
    id: reminders.length + 1,
    userId,
    text: content,
    time: reminderTime.toISOString(),
    sent: false
  };
  
  reminders.push(reminder);
  await reply(messageId, `Напоминание #${reminder.id} установлено на ${reminderTime.toLocaleTimeString()}`);
  
  // Запускаем таймер для напоминания
  const delay = reminderTime - now;
  setTimeout(async () => {
    await client.im.message.create({
      data: {
        receive_id: userId,
        content: JSON.stringify({
          text: `Напоминание: ${content}`
        }),
        msg_type: "text",
      },
    });
    reminder.sent = true;
  }, delay);
}

// Команда /admin
async function cmdAdmin(messageId, userId, text) {
  if (!adminUsers.includes(userId)) {
    await reply(messageId, "У вас нет прав администратора.");
    return;
  }

  // Убираем "/admin" из текста команды
  const commandText = text.replace("/admin", "").trim();

  // Разделяем оставшуюся часть команды на аргументы
  const [command, ...args] = commandText.split(' ');

  switch (command) {
    case "добавить_ответственного":
      const [shiftType, name, id] = args;
      if (shiftType === "дневная") {
        weeklyResponsibleRotation.dayTeam.push({name, id});
        responsibleEmployees.day.push(name);
      } else if (shiftType === "ночная") {
        weeklyResponsibleRotation.nightTeam.push({name, id});
        responsibleEmployees.night.push(name);
      }
      await reply(messageId, `Ответственный ${name} добавлен в ${shiftType} смену.`);
      break;
    case "удалить_ответственного":
      const [shiftTypeDel, nameDel] = args;
      if (shiftTypeDel === "дневная") {
        weeklyResponsibleRotation.dayTeam = weeklyResponsibleRotation.dayTeam.filter(emp => emp.name !== nameDel);
        responsibleEmployees.day = responsibleEmployees.day.filter(n => n !== nameDel);
      } else if (shiftTypeDel === "ночная") {
        weeklyResponsibleRotation.nightTeam = weeklyResponsibleRotation.nightTeam.filter(emp => emp.name !== nameDel);
        responsibleEmployees.night = responsibleEmployees.night.filter(n => n !== nameDel);
      }
      await reply(messageId, `Ответственный ${nameDel} удален из ${shiftTypeDel} смены.`);
      break;
    case "добавить_смену":
      const [date, shiftTypeAdd, ...names] = args;
      if (!shiftSchedule[date]) {
        shiftSchedule[date] = { day: [], night: [] };
      }
      if (shiftTypeAdd === "дневная") {
        shiftSchedule[date].day = names;
      } else if (shiftTypeAdd === "ночная") {
        shiftSchedule[date].night = names;
      }
      await reply(messageId, `График на ${date} обновлен.`);
      break;
    case "статистика":
      // Собираем статистику по запросам
      const activeRequests = requests.filter(r => r.status !== 'Завершено').length;
      const completedRequests = requests.filter(r => r.status === 'Завершено').length;
      const activeTasks = tasks.filter(t => t.status !== 'Готово').length;
      
      await reply(messageId, `Статистика:\nАктивные запросы: ${activeRequests}\nЗавершенные запросы: ${completedRequests}\nАктивные задачи: ${activeTasks}`);
      break;
    case "загрузка":
      // Анализ загрузки сотрудников
      const employeeWorkload = {};
      
      // Подсчитываем активные задачи на каждого сотрудника
      tasks.forEach(task => {
        if (task.status !== 'Готово') {
          if (!employeeWorkload[task.assigneeId]) {
            employeeWorkload[task.assigneeId] = 0;
          }
          employeeWorkload[task.assigneeId]++;
        }
      });
      
      // Подсчитываем активные запросы на каждого ответственного
      requests.forEach(req => {
        if (req.status !== 'Завершено' && req.assignedTo) {
          if (!employeeWorkload[req.assignedTo]) {
            employeeWorkload[req.assignedTo] = 0;
          }
          employeeWorkload[req.assignedTo]++;
        }
      });
      
      let workloadText = "Загрузка сотрудников:\n";
      for (const [empId, count] of Object.entries(employeeWorkload)) {
        workloadText += `- ${empId}: ${count} активных задач/запросов\n`;
      }
      
      await reply(messageId, workloadText);
      break;
    default:
      const adminHelp = `Админ-команды:\n/admin добавить_ответственного [дневная/ночная] [имя] [id]\n/admin удалить_ответственного [дневная/ночная] [имя]\n/admin добавить_смену [дата] [дневная/ночная] [имя1] [имя2] ...\n/admin статистика\n/admin загрузка`;
      await reply(messageId, adminHelp);
      break;
  }
}

// Получение текущего ответственного
function getResponsible() {
  const now = new Date().getHours();
  
  // Проверяем и обновляем ротацию при необходимости
  updateWeeklyResponsible();
  
  if (now >= 10 && now < 16) {
    return { 
      ids: responsibleEmployees.day.map(name => {
        const employee = weeklyResponsibleRotation.dayTeam.find(emp => emp.name === name);
        return employee ? employee.id : null;
      }).filter(id => id !== null)
    };
  } else if (now >= 16 && now < 21) {
    return { 
      ids: responsibleEmployees.night.map(name => {
        const employee = weeklyResponsibleRotation.nightTeam.find(emp => emp.name === name);
        return employee ? employee.id : null;
      }).filter(id => id !== null)
    };
  } else {
    // Возвращаем ID дежурного для ночного времени, если есть
    return { ids: ["дежурный_id"] };
  }
}

// Обработка кнопок
async function handleButtonClick(messageId, userId, value) {
  const [action, id] = value.split('_');
  const requestId = parseInt(id);
  
  switch (action) {
    case "take":
      const request = requests.find(r => r.id === requestId);
      if (request) {
        request.status = 'В работе';
        request.assignedTo = userId;
        
        // Уведомляем пользователя, создавшего запрос
        await client.im.message.create({
          data: {
            receive_id: request.userId,
            content: JSON.stringify({
              text: `Ваш запрос #${request.id} взят в работу.`
            }),
            msg_type: "text",
          },
        });
        
        await reply(messageId, `Вы взяли в работу запрос #${request.id} от ${request.userId}:\n${request.text}`, [
          { text: "Нужен апрув", value: `approve_${request.id}` },
          { text: "Не нужен апрув", value: `no_approve_${request.id}` },
        ]);
      }
      break;
    case "approve":
      await reply(messageId, `Выберите катмена для апрува запроса #${id}:`, [
        { text: "Катмен 1", value: `catman_1_${id}` },
        { text: "Катмен 2", value: `catman_2_${id}` },
      ]);
      break;
    case "no_approve":
      const requestNoApprove = requests.find(r => r.id === requestId);
      if (requestNoApprove) {
        await reply(messageId, `Запрос #${requestId} не требует апрува. Вы можете завершить его.`, [
          { text: "Готово", value: `finish_${requestId}` },
        ]);
      }
      break;
    case "catman":
      const [catmanId, reqId] = id.split('_');
      const approvalRequest = {
        id: approvals.length + 1,
        requestId: parseInt(reqId),
        catmanId,
        status: 'Ожидает',
        comment: '',
        createdAt: new Date().toISOString()
      };
      approvals.push(approvalRequest);
      
      // Отправляем запрос катмену
      await client.im.message.create({
        data: {
          receive_id: `catman_${catmanId}_id`, // ID катмена
          content: JSON.stringify({
            text: `Запрос #${reqId} требует вашего апрува.`,
            buttons: [
              { text: "Апрувнуть", value: `approve_ok_${approvalRequest.id}` },
              { text: "Отклонить", value: `approve_reject_${approvalRequest.id}` },
              { text: "Комментарий", value: `approve_comment_${approvalRequest.id}` },
            ]
          }),
          msg_type: "text",
        },
      });
      
      await reply(messageId, `Запрос #${reqId} отправлен катмену ${catmanId} для апрува.`);
      break;
    case "approve_ok":
      const approvalOk = approvals.find(a => a.id === parseInt(id));
      if (approvalOk) {
        approvalOk.status = 'Апрувнуто';
        const reqToApprove = requests.find(r => r.id === approvalOk.requestId);
        
        if (reqToApprove && reqToApprove.assignedTo) {
          // Уведомляем ответственного
          await client.im.message.create({
            data: {
              receive_id: reqToApprove.assignedTo,
              content: JSON.stringify({
                text: `Запрос #${reqToApprove.id} апрувнут катменом. Вы можете завершить его.`,
                buttons: [
                  { text: "Готово", value: `finish_${reqToApprove.id}` },
                ]
              }),
              msg_type: "text",
            },
          });
        }
        
        await reply(messageId, `Вы апрувнули запрос #${approvalOk.requestId}.`);
      }
      break;
    case "approve_reject":
      const approvalReject = approvals.find(a => a.id === parseInt(id));
      if (approvalReject) {
        approvalReject.status = 'Отклонено';
        const reqToReject = requests.find(r => r.id === approvalReject.requestId);
        
        if (reqToReject && reqToReject.assignedTo) {
          // Уведомляем ответственного
          await client.im.message.create({
            data: {
              receive_id: reqToReject.assignedTo,
              content: JSON.stringify({
                text: `Запрос #${reqToReject.id} отклонен катменом.`,
              }),
              msg_type: "text",
            },
          });
        }
        
        await reply(messageId, `Вы отклонили запрос #${approvalReject.requestId}. Пожалуйста, добавьте комментарий.`, [
          { text: "Добавить комментарий", value: `approve_comment_${approvalReject.id}` },
        ]);
      }
      break;
    case "approve_comment":
      // В реальном приложении здесь был бы обработчик для ввода комментария
      await reply(messageId, `Пожалуйста, напишите комментарий к запросу, начиная с префикса "#comment_${id}: "`);
      break;
    case "finish":
      const requestToFinish = requests.find(r => r.id === requestId);
      if (requestToFinish) {
        requestToFinish.status = 'Завершено';
        requestToFinish.completedAt = new Date().toISOString();
        
        // Уведомляем пользователя, создавшего запрос
        await client.im.message.create({
          data: {
            receive_id: requestToFinish.userId,
            content: JSON.stringify({
              text: `Ваш запрос #${requestToFinish.id} завершен:\n${requestToFinish.text}`
            }),
            msg_type: "text",
          },
        });
        
        await reply(messageId, `Запрос #${requestId} помечен как завершенный.`);
      }
      break;
    case "complete":
      const task = tasks.find(t => t.id === requestId);
      if (task) {
        task.status = 'Готово';
        task.completedAt = new Date().toISOString();
        
        // Уведомляем создателя задачи
        await client.im.message.create({
          data: {
            receive_id: task.creatorId,
            content: JSON.stringify({
              text: `Задача #${task.id} выполнена:\n${task.text}`
            }),
            msg_type: "text",
          },
        });
        
        await reply(messageId, `Задача #${requestId} помечена как выполненная.`);
      }
      break;
    case "question":
      const taskQuestion = tasks.find(t => t.id === requestId);
      if (taskQuestion) {
        // В реальном приложении здесь был бы обработчик для ввода вопроса
        await reply(messageId, `Пожалуйста, напишите ваш вопрос по задаче, начиная с префикса "#question_${id}: "`);
      }
      break;
    default:
      break;
  }
}

// Обработка комментариев и вопросов
async function handleComment(messageId, userId, text) {
  if (text.startsWith("#comment_")) {
    const parts = text.split(": ");
    const approvalId = parseInt(parts[0].replace("#comment_", ""));
    const commentText = parts[1];
    
    const approval = approvals.find(a => a.id === approvalId);
    if (approval) {
      approval.comment = commentText;
      
      const request = requests.find(r => r.id === approval.requestId);
      if (request && request.assignedTo) {
        // Отправляем комментарий ответственному
        await client.im.message.create({
          data: {
            receive_id: request.assignedTo,
            content: JSON.stringify({
              text: `Комментарий катмена к запросу #${request.id}:\n${commentText}`
            }),
            msg_type: "text",
          },
        });
      }
      
      await reply(messageId, `Комментарий к запросу #${approval.requestId} сохранен.`);
    }
  } else if (text.startsWith("#question_")) {
    const parts = text.split(": ");
    const taskId = parseInt(parts[0].replace("#question_", ""));
    const questionText = parts[1];
    
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      task.comments.push({
        userId,
        text: questionText,
        createdAt: new Date().toISOString()
      });
      
      // Отправляем вопрос создателю задачи
      await client.im.message.create({
        data: {
          receive_id: task.creatorId,
          content: JSON.stringify({
            text: `Вопрос по задаче #${task.id} от ${userId}:\n${questionText}`,
            buttons: [
              { text: "Ответить", value: `reply_question_${task.id}` },
            ]
          }),
          msg_type: "text",
        },
      });
      
      await reply(messageId, `Ваш вопрос по задаче #${taskId} отправлен руководителю.`);
    }
  }
}

// Проверка и отправка напоминаний (запускается периодически)
function checkReminders() {
  const now = new Date();
  
  reminders.forEach(reminder => {
    if (!reminder.sent) {
      const reminderTime = new Date(reminder.time);
      if (reminderTime <= now) {
        // Отправляем напоминание
        client.im.message.create({
          data: {
            receive_id: reminder.userId,
            content: JSON.stringify({
              text: `Напоминание: ${reminder.text}`
            }),
            msg_type: "text",
          },
        });
        reminder.sent = true;
      }
    }
  });
}

// Запускаем проверку напоминаний каждую минуту
setInterval(checkReminders, 60000);

// Обработка вебхука
app.post("/webhook", async (req, res) => {
    const { event } = req.body;
    if (!event || !event.message) return res.sendStatus(400);
    
    const text = JSON.parse(event.message.content).text;
    const messageId = event.message.message_id;
    const userId = event.sender.sender_id.user_id;

    // Проверяем, является ли сообщение комментарием или вопросом
    if (text.startsWith("#comment_") || text.startsWith("#question_")) {
      await handleComment(messageId, userId, text);
      return res.sendStatus(200);
    }
    
    // Обработка кнопок
    if (event.action && event.action.value) {
      await handleButtonClick(messageId, userId, event.action.value);
      return res.sendStatus(200);
    }

    switch (text.split(" ")[0]) {
        case "/help":
            await cmdHelp(messageId);
            break;
        case "/смена":
            await cmdSmena(messageId);
            break;
        case "/ответственные":
            await cmdResponsible(messageId);
            break;
        case "/запрос":
            await cmdRequest(messageId, userId, text);
            break;
        case "/помощник":
            await cmdHelper(messageId);
            break;
        case "/задача":
            await cmdTask(messageId, userId, text);
            break;
        case "/admin":
            await cmdAdmin(messageId, userId, text);
            break;
        case "/напоминание":
            await cmdReminder(messageId, userId, text);
            break;
        default:
            await reply(messageId, "Неизвестная команда. Используйте /help для списка команд.");
            break;
    }

    res.sendStatus(200);
});


// Запуск сервера
app.listen
