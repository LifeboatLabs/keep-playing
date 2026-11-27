// Example CloudScript, written the way PlayFab games write it.
// Call these with ExecuteCloudScript, e.g. FunctionName "helloWorld".

handlers.helloWorld = function (args, context) {
  var message = "Hello " + currentPlayerId + "!";
  log.info(message);
  return { messageValue: message };
};

// Fails on purpose, to show what a script error looks like to the game.
handlers.throwError = function (args, context) {
  var missing;
  return missing.notThere;
};

// Gives a daily reward once a day, using read-only data the player can't change.
handlers.claimDailyReward = function (args, context) {
  var today = new Date().toISOString().slice(0, 10);
  var data = server.GetUserReadOnlyData({ PlayFabId: currentPlayerId, Keys: ["lastReward"] }).Data;
  if (data.lastReward && data.lastReward.Value === today) {
    return { granted: false, reason: "Already claimed today" };
  }
  server.UpdateUserReadOnlyData({ PlayFabId: currentPlayerId, Data: { lastReward: today } });
  var result = server.AddUserVirtualCurrency({ PlayFabId: currentPlayerId, VirtualCurrency: "GO", Amount: 100 });
  log.debug("Daily reward given", { balance: result.Balance });
  return { granted: true, balance: result.Balance };
};

// Saves a level result and keeps the best score.
handlers.finishLevel = function (args, context) {
  if (!args || typeof args.score !== "number") throw new Error("finishLevel needs a score");
  server.UpdatePlayerStatistics({
    PlayFabId: currentPlayerId,
    Statistics: [{ StatisticName: "HighScore", Value: args.score }]
  });
  var stats = server.GetPlayerStatistics({ PlayFabId: currentPlayerId, StatisticNames: ["HighScore"] }).Statistics;
  return { best: stats.length ? stats[0].Value : args.score };
};

// Shows how a failed API call can be caught.
handlers.lookUpSomeone = function (args, context) {
  try {
    server.GetUserAccountInfo({ PlayFabId: args.playFabId });
    return { found: true };
  } catch (e) {
    return { found: false, error: e.apiErrorInfo.apiError.error };
  }
};
