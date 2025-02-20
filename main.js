const lark = require("@larksuiteoapi/node-sdk");
const express = require("express");

const LARK_APP_ID = process.env.APPID || "";
const LARK_APP_SECRET = process.env.SECRET || "";
const PORT = process.env.PORT || 10000;

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
let adminUsers = []; // Админы
let requests = []; // Запросы
let approvals = []; // Запросы на апрув

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
  const helpText = `Доступные команды:\n\n/help - показать это сообщение\n/смена - узнать, кто сейчас на смене\n/ответственные - узнать ответственных за запросы\n/запрос - отправить запрос\n/помощник - получить справочную информацию\n/задача - отправить задачу\n/admin - админские функции`;
  await reply(messageId, helpText);
}

// Команда /смена
async function cmdSmena(messageId) {
  const today = new Date().toISOString().split('T')[0];
  const shift = shiftSchedule[today] || { day: ["Нет данных"], night: ["Нет данных"] };
  await reply(messageId, `Сейчас на смене:\nДневная: ${shift.day.join(', ')}\nНочная: ${shift.night.join(', ')}`);
}

// Команда /ответственные
async function cmdResponsible(messageId) {
  await reply(messageId, `Ответственные за запросы:\nДневная: ${responsibleEmployees.day.join(', ')}\nНочная: ${responsibleEmployees.night.join(', ')}`);
}

// Команда /запрос
async function cmdRequest(messageId, userId, text) {
  const request = { id: requests.length + 1, userId, text, status: 'В обработке' };
  requests.push(request);

  // Уведомление ответственному
  const responsible = getResponsible();
  await reply(responsible.messageId, `Новый запрос от пользователя ${userId}:\n${text}`, [
    { text: "Взял в работу", value: `take_${request.id}` },
  ]);

  await reply(messageId, "Ваш запрос в обработке.");
}

// Команда /помощник
async function cmdHelper(messageId) {
  const helpText = `Помощник:\nКомиссии: [ссылка]\nМинималки: [ссылка]`;
  await reply(messageId, helpText);
}

// Команда /задача
async function cmdTask(messageId, userId, text) {
  const task = { id: tasks.length + 1, userId, text, status: 'Назначена' };
  tasks.push(task);

  // Уведомление сотруднику
  await reply(task.userId, `Новая задача от руководителя:\n${text}`, [
    { text: "Готово", value: `complete_${task.id}` },
  ]);

  await reply(messageId, "Задача отправлена.");
}

// Команда /admin
async function cmdAdmin(messageId, userId, text) {
  if (!adminUsers.includes(userId)) {
    await reply(messageId, "У вас нет прав администратора.");
    return;
  }

  const [command, ...args] = text.split(' ');
  switch (command) {
    case "добавить_ответственного":
      const [shiftType, name] = args;
      if (shiftType === "дневная") {
        responsibleEmployees.day.push(name);
      } else if (shiftType === "ночная") {
        responsibleEmployees.night.push(name);
      }
      await reply(messageId, `Ответственный ${name} добавлен в ${shiftType} смену.`);
      break;
    case "удалить_ответственного":
      const [shiftTypeDel, nameDel] = args;
      if (shiftTypeDel === "дневная") {
        responsibleEmployees.day = responsibleEmployees.day.filter(n => n !== nameDel);
      } else if (shiftTypeDel === "ночная") {
        responsibleEmployees.night = responsibleEmployees.night.filter(n => n !== nameDel);
      }
      await reply(messageId, `Ответственный ${nameDel} удален из ${shiftTypeDel} смены.`);
      break;
    default:
      await reply(messageId, "Неизвестная команда админа.");
      break;
  }
}

// Получение текущего ответственного
function getResponsible() {
  const now = new Date().getHours();
  if (now >= 10 && now < 16) {
    return { messageId: responsibleEmployees.day[0] };
  } else if (now >= 16 && now < 21) {
    return { messageId: responsibleEmployees.night[0] };
  } else {
    return { messageId: "Нет ответственного" };
  }
}

// Обработка кнопок
async function handleButtonClick(messageId, userId, value) {
  const [action, id] = value.split('_');
  switch (action) {
    case "take":
      const request = requests.find(r => r.id === parseInt(id));
      if (request) {
        request.status = 'В работе';
        await reply(messageId, `Вы взяли в работу запрос от ${request.userId}:\n${request.text}`, [
          { text: "Нужен апрув", value: `approve_${request.id}` },
          { text: "Не нужен апрув", value: `no_approve_${request.id}` },
        ]);
      }
      break;
    case "approve":
      await reply(messageId, "Выберите катмена для апрува:", [
        { text: "Катмен 1", value: `catman_1_${id}` },
        { text: "Катмен 2", value: `catman_2_${id}` },
      ]);
      break;
    case "no_approve":
      const requestNoApprove = requests.find(r => r.id === parseInt(id));
      if (requestNoApprove) {
        requestNoApprove.status = 'Завершено';
        await reply(requestNoApprove.userId, `Ваш запрос завершен:\n${requestNoApprove.text}`);
      }
      break;
    case "catman":
      const [catmanId, requestId] = id.split('_');
      await reply(messageId, `Запрос отправлен катмену ${catmanId} для апрува.`);
      break;
    case "complete":
      const task = tasks.find(t => t.id === parseInt(id));
      if (task) {
        task.status = 'Готово';
        await reply(userId, `Задача выполнена:\n${task.text}`);
      }
      break;
    default:
      break;
  }
}

// Обработка вебхука
app.post("/webhook", async (req, res) => {
    const { event } = req.body;
    if (!event || !event.message) return res.sendStatus(400);
    
    const text = JSON.parse(event.message.content).text;
    const messageId = event.message.message_id;
    const userId = event.sender.sender_id.user_id;

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
        default:
            await reply(messageId, "Неизвестная команда. Используйте /help для списка команд.");
            break;
    }

    res.sendStatus(200);
});


// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
