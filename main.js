const lark = require("@larksuiteoapi/node-sdk");

const LARK_APP_ID = process.env.APPID || ""; // Larksuite appid 
const LARK_APP_SECRET = process.env.SECRET || ""; // larksuite app secret

const client = new lark.Client({
  appId: LARK_APP_ID,
  appSecret: LARK_APP_SECRET,
  disableTokenCache: false,
  domain: lark.Domain.Lark
});

function logger(param) {
  console.error(`[CF]`, param);
}

async function reply(messageId, content) {
  try {
    return await client.im.message.reply({
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify({
          text: content,
        }),
        msg_type: "text",
      },
    });
  } catch (e) {
    logger("send message to Lark error", e, messageId, content);
  }
}

// command process
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

// help command
async function cmdHelp(messageId) {
  const helpText = `Доступные команды:

/help    - показать это сообщение
/смена   - узнать, кто сейчас на смене
`;
  await reply(messageId, helpText);
}

// команда /смена
async function cmdSmena(messageId) {
  await reply(messageId, "Сейчас на смене: Руслан");
}

// self check doctor
async function doctor() {
  if (LARK_APP_ID === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置 Lark 应用的 AppID，请检查 & 部署后重试",
        en_US: "Here is no Lark APP id, please check & re-Deploy & call again",
      },
    };
  }
  if (!LARK_APP_ID.startsWith("cli_")) {
    return {
      code: 1,
      message: {
        zh_CN: "你配置的 Lark 应用的 AppID 是错误的，请检查后重试。 Lark 应用的 APPID 以 cli_ 开头。",
        en_US: "Your Lark App ID is Wrong, Please Check and call again. Lark APPID must Start with cli",
      },
    };
  }
  if (LARK_APP_SECRET === "") {
    return {
      code: 1,
      message: {
        zh_CN: "你没有配置 Lark 应用的 Secret，请检查 & 部署后重试",
        en_US: "Here is no Lark APP Secret, please check & re-Deploy & call again",
      },
    };
  }
  return {
    code: 0,
    message: {
      zh_CN: "✅ 配置成功，接下来你可以在 Lark 应用当中使用机器人来完成你的工作。",
      en_US: "✅ Configuration is correct, you can use this bot in your Lark App",
    },
    meta: {
      LARK_APP_ID,
    },
  };
}

async function handleReply(userInput, messageId) {
  const question = userInput.text.replace("@_user_1", "");
  logger("question: " + question);
  const action = question.trim();
  if (action.startsWith("/")) {
    return await cmdProcess({ action, messageId });
  }
  await reply(messageId, "Я понимаю только команды. Введите /help для списка команд.");
  return { code: 0 };
}

module.exports = async function (params, context) {
  // if have a encrypt, let use close it.
  if (params.encrypt) {
    logger("user enable encrypt key");
    return {
      code: 1,
      message: {
        zh_CN: "你配置了 Encrypt Key，请关闭该功能。",
        en_US: "You have open Encrypt Key Feature, please close it.",
      },
    };
  }
  // process url_verification
  if (params.type === "url_verification") {
    logger("deal url_verification");
    return {
      challenge: params.challenge,
    };
  }
  // build a doctor for debug
  if (!params.hasOwnProperty("header") || context.trigger === "DEBUG") {
    logger("enter doctor");
    return await doctor();
  }
  // process event 
  if ((params.header.event_type === "im.message.receive_v1")) {
    let messageId = params.event.message.message_id;

    // replay in private chat
    if (params.event.message.chat_type === "p2p") {
      // don't reply except text
      if (params.event.message.message_type != "text") {
        await reply(messageId, "Поддерживаются только текстовые сообщения.");
        logger("skip and reply not support");
        return { code: 0 };
      }
      // reply text
      const userInput = JSON.parse(params.event.message.content);
      return await handleReply(userInput, messageId);
    }

    // group chat process
    if (params.event.message.chat_type === "group") {
      const userInput = JSON.parse(params.event.message.content);
      return await handleReply(userInput, messageId);
    }
  }

  logger("return without other log");
  return {
    code: 2,
  };
};
