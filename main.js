/*
google apps script

  install:
    Gogole Drive > create spread sheet > tools > script editor > paste this file > save > run onOpen

  schedule:
    Tools > Script editor... > Resources > Current project's triggers > select healthCheck as a function
*/

var SLACK_WEBHOOK_URL = "SLACK_WEBHOOK_URL";
var SLACK_CHANNEL = "SLACK_CHANNEL";
var BODY_LEN = "BODY_LEN";

var GREEN1 = "#8ACE6B";
var RED1 = "#F6898A";
var GRAY1 = "#E0E0E0";

function toBool(str) {
  if (typeof str !== "string") return !!str;
  return str.toLowerCase() !== "false";
}

function toNum(str) {
  if (typeof str === "number") return str;
  if (typeof str === "string") return Number(str);
  return undefined;
}

function isEmptyObj(obj) {
  if (!obj) return true;
  if (typeof obj !== "object") return true;
  if (!Object.keys(obj).length) return true;
  return false;
}

function notEmptyObj(obj) { return !isEmptyObj(obj); }

function parseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (err) {
    return str;
  }
}

function jsonToString(obj) {
  return JSON.stringify(obj, null, "  ");
}

function getSheet() { return SpreadsheetApp.getActiveSheet(); }
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function setColor(range, params) {
  params = params || {};
  bgColor = params.bgColor || "#ffffff";
  fontColor = params.fontColor || "#222222";
  range.setBackground(bgColor);
  range.setFontColor(fontColor);
}

function getProps() {
  var dp, slackWebhookUrl, slackChannel;
  dp = PropertiesService.getDocumentProperties();
  slackWebhookUrl = dp.getProperty(SLACK_WEBHOOK_URL);
  slackChannel = dp.getProperty(SLACK_CHANNEL);
  bodyLength = dp.getProperty(BODY_LEN);

  bodyLength = toNum(bodyLength);

  return {
    slackWebhookUrl: slackWebhookUrl,
    slackChannel: slackChannel,
    bodyLength: bodyLength
  };
}

// assume the first row is the fields
function getFields(sheet) {
  if (!sheet) sheet = getSheet();

  var rows = sheet.getDataRange();
  var values = rows.getValues();

  if (!values.length) return [];

  return values.shift();
}

function getSheetRows(sheet) {
  if (!sheet) sheet = getSheet();
  var rows = sheet.getDataRange();
  var values = rows.getValues();
  var fields = values.shift();

  if (!values.length) return;

  // skip rows below the lines begin with '#'
  var i = 0;
  while (values[i] && values[i][0].indexOf("#") !== 0) { i++; }
  values = values.slice(0, i);

  var arr = values.map(function(row) {
    var o = {};
    fields.forEach(function(field, i) {
      if (!field) return;
      if (row[i] === "") return;
      o[field] = parseJSON(row[i]);
    });
    return o;
  });

  arr = arr.filter(function(obj) { return notEmptyObj(obj); });
  return arr;
}

function alert(msg) {
  if (msg && Browser && Browser.msgBox) Browser.msgBox(msg);
}

function onOpen() {
  ss().addMenu('Custom Menu', [
    {
      name: 'health check list',
      functionName: 'printContent'
    }, {
      name: 'check right now',
      functionName: 'healthCheck'
    }, {
      name: 'notification settings',
      functionName: 'setDestination'
    }, {
      name: 'output settings',
      functionName: 'setOutputSettings'
    }, {
      name: 'help',
      functionName: 'showHelp'
    }
  ]);
}

function printContent() {
  var sheet = getSheetRows();
  if (sheet) alert(jsonToString(sheet));
}

function healthCheck() {
  var sheet = getSheet();
  var rows = getSheetRows();
  if (!rows || !rows.length) alert("health check list is invalid. see Custom Menu > help");
  rows.forEach(function(row, i) { sendRequest(row, i+1, sheet); });
}

function setDestination() {
  var dp = PropertiesService.getDocumentProperties();
  var slackWebhookUrl = Browser.inputBox('Enter Slack Webhook URL (required)', Browser.Buttons.OK_CANCEL);
  var slackChannel = Browser.inputBox('Enter Slack Channel (optional)', Browser.Buttons.OK_CANCEL);

  // slack channel is expected to begin with #
  if (slackChannel && slackChannel.indexOf("#") !== 0) slackChannel = "#" + slackChannel;

  dp.setProperty(SLACK_WEBHOOK_URL, slackWebhookUrl);
  dp.setProperty(SLACK_CHANNEL, slackChannel);
}

function setOutputSettings() {
  var dp = PropertiesService.getDocumentProperties();
  var bodyLength = Browser.inputBox('Enter body limit length (default 1024)', Browser.Buttons.OK_CANCEL);

  dp.setProperty(BODY_LEN, bodyLength);
}

function showHelp() {
  alert("https://github.com/kei-sato/gas-health-check");
}

function sendMessage(message) {
  sendMessageSlack(message);
}

// curl -X POST --data-urlencode 'payload={"channel": "#general", "text": ""}' https://hooks.slack.com/services/...
function sendMessageSlack(message) {
  var props = getProps() || {};
  var slackWebhookUrl = props.slackWebhookUrl;
  var slackChannel = props.slackChannel;
  if (!slackWebhookUrl) {
    ss().toast("notification settings not found. see Custom Menu > notification settings");
    return;
  }

  var payload = JSON.stringify({
    channel: slackChannel || undefined,
    text: message
  });

  var url = slackWebhookUrl;
  var params = {
    method: "post",
    payload: "payload="+payload,
  };

  var response = UrlFetchApp.fetch(url, params);
}

function checkResponseHealth(expect, result) {
  expect = expect || {};

  var success = true;
  Object.keys(expect).forEach(function(key) {
    if (expect[key] && expect[key] !== result[key]) success = false;
  });
  return success;
}

function sendRequest(row, rowIndex, sheet) {
  var url = row.url;
  var params = {
    contentType: row.contentType || undefined,
    headers: row.headers || undefined,
    method: row.method || undefined,
    payload: row.payload || undefined,
    validateHttpsCertificate: toBool(row.validateHttpsCertificate),
    muteHttpExceptions: true
  };
  var expectResponse = parseJSON(row.expectResponse) || {};
  expectResponse.status = expectResponse.status || 200;

  if (!url) return setStatus("URL NOT FOUND", rowIndex, sheet);

  var response;
  try {
    response = UrlFetchApp.fetch(url, params);
  } catch (err) {
    sendMessage(err.toString());
    return setStatus(err, rowIndex, sheet);
  }
  var status = response.getResponseCode();
  var body = response.getContentText();

  var success = checkResponseHealth(expectResponse, { status: status, body: body });
  var failed = !success;

  if (failed) {
    sendMessage("health check failed!\n"+url+"\nstatus: " + status);
  }

  setStatus(status, rowIndex, failed, sheet);
  setBody(body, rowIndex, sheet);
}

function setStatus(status, rowIndex, failed, sheet) {
  var fields = getFields();

  // find index of status field
  var statusIndex = -1;
  fields.forEach(function(el, i) { if (el.toLowerCase() === "status") statusIndex = i; });

  // create fields of status if not exists
  if (statusIndex < 0) {
    getCell(fields.length, 0, sheet).setValue("status");
    statusIndex = fields.length;
  }

  // set value 
  var cell = getCell(statusIndex, rowIndex, sheet);
  cell.setValue(status);
  setColor(cell, { bgColor: failed ? RED1 : GREEN1  });
}

function setBody(body, rowIndex, sheet) {
  var props = getProps() || {};
  body = body || "";
  body = body.slice(0, props.bodyLength || 1024);

  var fields = getFields();

  // find index of body field
  var bodyIndex = -1;
  fields.forEach(function(el, i) { if (el.toLowerCase() === "body") bodyIndex = i; });

  // create fields of body if not exists
  if (bodyIndex < 0) {
    getCell(fields.length, 0, sheet).setValue("body");
    bodyIndex = fields.length;
  }

  // set value 
  var cell = getCell(bodyIndex, rowIndex, sheet);
  cell.setValue(body);
  setColor(cell, { bgColor: GRAY1  });
}

// x, y start from 0 (means top cell's coordinate is (0,0))
function getCell(x, y, sheet) {
  if (!sheet) sheet = getSheet();
  return sheet.getRange(y+1, x+1);
}
