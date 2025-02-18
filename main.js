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

function logger(param) {
  console.error("[CF]", param);
}

async function reply(messageId, content) {
  try {
    return await client.im.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify({ text: content }),
        msg_type: "text",
      },
    });
  } catch (e) {
    logger("send message to Lark error", e, messageId, content);
  }
}

async function cmdProcess(cmdParams) {
  switch (cmdParams && cmdParams.action) {
    case "/help":
      await cmdHelp(cmdParams.messageId);
      break;
    case "/смена":
      await cmdSmena(cmdParams.messageId);
      break;
    default:
      await cmdHelp(cmdParams.messageId);
      break;
  }
  return { code: 0 };
}

async function cmdHelp(messageId) {
  const helpText = `Доступные команды:\n\n/help    - показать это сообщение\n/смена   - узнать, кто сейчас на смене`;
  await reply(messageId, helpText);
}

async function cmdSmena(messageId) {
  await reply(messageId, "Сейчас на смене: Руслан");
}

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.post("/webhook", async (req, res) => {
  const { type, challenge, event } = req.body;

  // Логируем входящий запрос
  logger("Received request:", JSON.stringify(req.body, null, 2));

  if (type === "url_verification") {
    logger("Received url_verification request");
    return res.json({ challenge });
  }

  if (type === "event_callback" && event.type === "im.message.receive_v1") {
    const messageId = event.message.message_id;
    const userInput = JSON.parse(event.message.content);
    logger("Received message:", userInput);

    const text = userInput.text.trim();
    if (text.startsWith("/")) {
      await cmdProcess({ action: text, messageId });
    } else {
      await reply(messageId, "Я понимаю только команды. Введите /help для списка команд.");
    }
  } else {
    logger("Unknown event type:", type);
  }

  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
