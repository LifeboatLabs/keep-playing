# What Keep Playing answers

Keep Playing answers **353 of the 797** PlayFab calls that Microsoft still lists. (Microsoft's description has 843 calls; 46 of them are retired.)

Every answer is checked against Microsoft's description in the tests. Made by `node tools/coverage.js` from [PlayFab/API_Specs](https://github.com/PlayFab/API_Specs) at commit `06cab88` (2026-11-18).

| Area | Working | Calls |
|---|---:|---:|
| Client | 120 | 174 |
| Server | 119 | 163 |
| Admin | 59 | 129 |
| Group | 25 | 25 |
| Match | 13 | 20 |
| Profile | 5 | 10 |
| File | 5 | 5 |
| Event | 2 | 16 |
| Authentication | 2 | 2 |
| Object | 2 | 2 |
| CloudScript | 1 | 15 |
| MultiplayerServer | 0 | 54 |
| Addon | 0 | 31 |
| Catalog | 0 | 31 |
| Inventory | 0 | 20 |
| TrueSkill | 0 | 19 |
| Lobby | 0 | 16 |
| Experimentation | 0 | 13 |
| Leaderboard | 0 | 13 |
| Statistic | 0 | 11 |
| StateShare | 0 | 7 |
| VersionedCatalog | 0 | 7 |
| Insights | 0 | 6 |
| Party | 0 | 3 |
| GameServerIdentity | 0 | 2 |
| Sweepstakes | 0 | 2 |
| Locale | 0 | 1 |
| **All** | **353** | **797** |

## Client

Working: `AddFriend`, `AddGenericID`, `AddOrUpdateContactEmail`, `AddSharedGroupMembers`, `AddUsernamePassword`, `AddUserVirtualCurrency`, `AndroidDevicePushNotificationRegistration`, `AttributeInstall`, `ConsumeItem`, `CreateSharedGroup`, `DeletePlayerCustomProperties`, `ExecuteCloudScript`, `GetAccountInfo`, `GetAdPlacements`, `GetAllUsersCharacters`, `GetCatalogItems`, `GetCharacterData`, `GetCharacterInventory`, `GetCharacterLeaderboard`, `GetCharacterReadOnlyData`, `GetCharacterStatistics`, `GetFriendLeaderboard`, `GetFriendLeaderboardAroundPlayer`, `GetFriendsList`, `GetLeaderboard`, `GetLeaderboardAroundCharacter`, `GetLeaderboardAroundPlayer`, `GetLeaderboardForUserCharacters`, `GetPlayerCombinedInfo`, `GetPlayerCustomProperty`, `GetPlayerProfile`, `GetPlayerSegments`, `GetPlayerStatistics`, `GetPlayerStatisticVersions`, `GetPlayerTags`, `GetPlayFabIDsFromBattleNetAccountIds`, `GetPlayFabIDsFromFacebookInstantGamesIds`, `GetPlayFabIDsFromGameCenterIDs`, `GetPlayFabIDsFromGenericIDs`, `GetPlayFabIDsFromKongregateIDs`, `GetPlayFabIDsFromNintendoServiceAccountIds`, `GetPlayFabIDsFromNintendoSwitchDeviceIds`, `GetPlayFabIDsFromOpenIdSubjectIdentifiers`, `GetPlayFabIDsFromSteamIDs`, `GetPublisherData`, `GetSharedGroupData`, `GetStoreItems`, `GetTime`, `GetTitleData`, `GetTitleNews`, `GetUserData`, `GetUserInventory`, `GetUserPublisherData`, `GetUserPublisherReadOnlyData`, `GetUserReadOnlyData`, `GrantCharacterToUser`, `LinkAndroidDeviceID`, `LinkApple`, `LinkBattleNetAccount`, `LinkCustomID`, `LinkFacebookInstantGamesId`, `LinkGameCenterAccount`, `LinkIOSDeviceID`, `LinkKongregate`, `LinkNintendoServiceAccount`, `LinkNintendoSwitchDeviceId`, `LinkOpenIdConnect`, `LinkSteamAccount`, `ListPlayerCustomProperties`, `LoginWithAndroidDeviceID`, `LoginWithApple`, `LoginWithBattleNet`, `LoginWithCustomID`, `LoginWithEmailAddress`, `LoginWithFacebookInstantGamesId`, `LoginWithGameCenter`, `LoginWithIOSDeviceID`, `LoginWithKongregate`, `LoginWithNintendoServiceAccount`, `LoginWithNintendoSwitchDeviceId`, `LoginWithOpenIdConnect`, `LoginWithPlayFab`, `LoginWithSteam`, `PurchaseItem`, `RegisterForIOSPushNotification`, `RegisterPlayFabUser`, `RemoveContactEmail`, `RemoveFriend`, `RemoveGenericID`, `RemoveSharedGroupMembers`, `ReportDeviceInfo`, `ReportPlayer`, `SetFriendTags`, `SubtractUserVirtualCurrency`, `UnlinkAndroidDeviceID`, `UnlinkApple`, `UnlinkBattleNetAccount`, `UnlinkCustomID`, `UnlinkFacebookInstantGamesId`, `UnlinkGameCenterAccount`, `UnlinkIOSDeviceID`, `UnlinkKongregate`, `UnlinkNintendoServiceAccount`, `UnlinkNintendoSwitchDeviceId`, `UnlinkOpenIdConnect`, `UnlinkSteamAccount`, `UnlockContainerInstance`, `UnlockContainerItem`, `UpdateAvatarUrl`, `UpdateCharacterData`, `UpdateCharacterStatistics`, `UpdatePlayerCustomProperties`, `UpdatePlayerStatistics`, `UpdateSharedGroupData`, `UpdateUserData`, `UpdateUserPublisherData`, `UpdateUserTitleDisplayName`, `WriteCharacterEvent`, `WritePlayerEvent`, `WriteTitleEvent`

Not yet: AcceptTrade, CancelTrade, ConfirmPurchase, ConsumeMicrosoftStoreEntitlements, ConsumePS5Entitlements, ConsumePSNEntitlements, ConsumeXboxEntitlements, GetContentDownloadUrl, GetPaymentToken, GetPhotonAuthenticationToken, GetPlayerTrades, GetPlayFabIDsFromFacebookIDs, GetPlayFabIDsFromGoogleIDs, GetPlayFabIDsFromGooglePlayGamesPlayerIDs, GetPlayFabIDsFromPSNAccountIDs, GetPlayFabIDsFromPSNOnlineIDs, GetPlayFabIDsFromSteamNames, GetPlayFabIDsFromTwitchIDs, GetPlayFabIDsFromXboxLiveIDs, GetPurchase, GetTitlePublicKey, GetTradeStatus, LinkFacebookAccount, LinkGoogleAccount, LinkGooglePlayGamesServicesAccount, LinkPSNAccount, LinkTwitch, LinkXboxAccount, LoginWithFacebook, LoginWithGoogleAccount, LoginWithGooglePlayGamesServices, LoginWithPSN, LoginWithTwitch, LoginWithXbox, OpenTrade, PayForPurchase, RedeemCoupon, RefreshPSNAuthToken, ReportAdActivity, RestoreIOSPurchases, RewardAdActivity, SendAccountRecoveryEmail, SetPlayerSecret, StartPurchase, UnlinkFacebookAccount, UnlinkGoogleAccount, UnlinkGooglePlayGamesServicesAccount, UnlinkPSNAccount, UnlinkTwitch, UnlinkXboxAccount, ValidateAmazonIAPReceipt, ValidateGooglePlayPurchase, ValidateIOSReceipt, ValidateWindowsStoreReceipt

## Server

Working: `AddCharacterVirtualCurrency`, `AddFriend`, `AddGenericID`, `AddOrUpdateContactEmail`, `AddPlayerTag`, `AddSharedGroupMembers`, `AddUserVirtualCurrency`, `AuthenticateSessionTicket`, `BanUsers`, `ConsumeItem`, `CreateSharedGroup`, `DeleteCharacterFromUser`, `DeletePlayer`, `DeletePlayerCustomProperties`, `DeleteSharedGroup`, `ExecuteCloudScript`, `GetAllUsersCharacters`, `GetCatalogItems`, `GetCharacterData`, `GetCharacterInternalData`, `GetCharacterInventory`, `GetCharacterLeaderboard`, `GetCharacterReadOnlyData`, `GetCharacterStatistics`, `GetFriendLeaderboard`, `GetFriendsList`, `GetLeaderboard`, `GetLeaderboardAroundCharacter`, `GetLeaderboardAroundUser`, `GetLeaderboardForUserCharacters`, `GetPlayerCombinedInfo`, `GetPlayerCustomProperty`, `GetPlayerProfile`, `GetPlayerSegments`, `GetPlayerStatistics`, `GetPlayerStatisticVersions`, `GetPlayerTags`, `GetPlayFabIDsFromBattleNetAccountIds`, `GetPlayFabIDsFromFacebookInstantGamesIds`, `GetPlayFabIDsFromGenericIDs`, `GetPlayFabIDsFromNintendoServiceAccountIds`, `GetPlayFabIDsFromNintendoSwitchDeviceIds`, `GetPlayFabIDsFromOpenIdSubjectIdentifiers`, `GetPlayFabIDsFromServerCustomIDs`, `GetPlayFabIDsFromSteamIDs`, `GetPublisherData`, `GetServerCustomIDsFromPlayFabIDs`, `GetSharedGroupData`, `GetStoreItems`, `GetTime`, `GetTitleData`, `GetTitleInternalData`, `GetTitleNews`, `GetUserAccountInfo`, `GetUserBans`, `GetUserData`, `GetUserInternalData`, `GetUserInventory`, `GetUserPublisherData`, `GetUserPublisherInternalData`, `GetUserPublisherReadOnlyData`, `GetUserReadOnlyData`, `GrantCharacterToUser`, `GrantItemsToCharacter`, `GrantItemsToUser`, `LinkBattleNetAccount`, `LinkNintendoServiceAccount`, `LinkNintendoServiceAccountSubject`, `LinkNintendoSwitchDeviceId`, `LinkServerCustomId`, `ListPlayerCustomProperties`, `LoginWithBattleNet`, `LoginWithNintendoServiceAccount`, `LoginWithServerCustomId`, `ModifyItemUses`, `MoveItemToCharacterFromCharacter`, `MoveItemToCharacterFromUser`, `MoveItemToUserFromCharacter`, `RemoveFriend`, `RemoveGenericID`, `RemovePlayerTag`, `RemoveSharedGroupMembers`, `ReportPlayer`, `RevokeAllBansForUser`, `RevokeInventoryItem`, `RevokeInventoryItems`, `SetFriendTags`, `SetPublisherData`, `SetTitleData`, `SetTitleInternalData`, `SubtractCharacterVirtualCurrency`, `SubtractUserVirtualCurrency`, `UnlinkApple`, `UnlinkBattleNetAccount`, `UnlinkFacebookInstantGamesId`, `UnlinkGameCenterAccount`, `UnlinkNintendoServiceAccount`, `UnlinkNintendoSwitchDeviceId`, `UnlinkServerCustomId`, `UnlockContainerInstance`, `UnlockContainerItem`, `UpdateAvatarUrl`, `UpdateCharacterData`, `UpdateCharacterInternalData`, `UpdateCharacterReadOnlyData`, `UpdateCharacterStatistics`, `UpdatePlayerCustomProperties`, `UpdatePlayerStatistics`, `UpdateSharedGroupData`, `UpdateUserData`, `UpdateUserInternalData`, `UpdateUserInventoryItemCustomData`, `UpdateUserPublisherData`, `UpdateUserPublisherInternalData`, `UpdateUserPublisherReadOnlyData`, `UpdateUserReadOnlyData`, `WriteCharacterEvent`, `WritePlayerEvent`, `WriteTitleEvent`

Not yet: AwardSteamAchievement, DeletePushNotificationTemplate, EvaluateRandomResultTable, ExportPlayersInSegment, GetAllSegments, GetContentDownloadUrl, GetPlayFabIDsFromFacebookIDs, GetPlayFabIDsFromPSNAccountIDs, GetPlayFabIDsFromPSNOnlineIDs, GetPlayFabIDsFromSteamNames, GetPlayFabIDsFromTwitchIDs, GetPlayFabIDsFromXboxLiveIDs, GetRandomResultTables, GetSegmentExport, GetSegmentPlayerCount, GrantItemsToUsers, LinkPSNAccount, LinkPSNId, LinkSteamId, LinkTwitchAccount, LinkXboxAccount, LinkXboxId, LoginWithAndroidDeviceID, LoginWithCustomID, LoginWithIOSDeviceID, LoginWithPSN, LoginWithSteamId, LoginWithTwitch, LoginWithXbox, LoginWithXboxId, RedeemCoupon, RevokeBans, SavePushNotificationTemplate, SendCustomAccountRecoveryEmail, SendEmailFromTemplate, SendPushNotification, SendPushNotificationFromTemplate, SetPlayerSecret, UnlinkFacebookAccount, UnlinkPSNAccount, UnlinkSteamId, UnlinkTwitchAccount, UnlinkXboxAccount, UpdateBans

## Admin

Working: `AddNews`, `AddPlayerTag`, `AddUserVirtualCurrency`, `AddVirtualCurrencyTypes`, `BanUsers`, `CreatePlayerStatisticDefinition`, `DeletePlayer`, `DeletePlayerCustomProperties`, `DeleteStore`, `GetCatalogItems`, `GetCloudScriptRevision`, `GetCloudScriptVersions`, `GetPlayerCustomProperty`, `GetPlayerProfile`, `GetPlayerSegments`, `GetPlayerStatisticDefinitions`, `GetPlayerStatisticVersions`, `GetPlayerTags`, `GetPublisherData`, `GetStoreItems`, `GetTitleData`, `GetTitleInternalData`, `GetUserAccountInfo`, `GetUserBans`, `GetUserData`, `GetUserInternalData`, `GetUserInventory`, `GetUserPublisherData`, `GetUserPublisherInternalData`, `GetUserPublisherReadOnlyData`, `GetUserReadOnlyData`, `IncrementPlayerStatisticVersion`, `ListPlayerCustomProperties`, `ListVirtualCurrencyTypes`, `RemovePlayerTag`, `RemoveVirtualCurrencyTypes`, `ResetCharacterStatistics`, `RevokeAllBansForUser`, `RevokeInventoryItem`, `RevokeInventoryItems`, `SetCatalogItems`, `SetPublishedRevision`, `SetPublisherData`, `SetStoreItems`, `SetTitleData`, `SetTitleInternalData`, `SubtractUserVirtualCurrency`, `UpdateCatalogItems`, `UpdateCloudScript`, `UpdatePlayerCustomProperties`, `UpdatePlayerStatisticDefinition`, `UpdateStoreItems`, `UpdateUserData`, `UpdateUserInternalData`, `UpdateUserPublisherData`, `UpdateUserPublisherInternalData`, `UpdateUserPublisherReadOnlyData`, `UpdateUserReadOnlyData`, `UpdateUserTitleDisplayName`

Not yet: AbortTaskInstance, AddLocalizedNews, CheckLimitedEditionItemAvailability, CreateActionsOnPlayersInSegmentTask, CreateCloudScriptAzureFunctionsTask, CreateCloudScriptTask, CreateInsightsScheduledScalingTask, CreateIPBan, CreateOpenIdConnection, CreatePlayerSharedSecret, CreateSegment, DeleteContent, DeleteEventSink, DeleteMasterPlayerAccount, DeleteMasterPlayerEventData, DeleteMembershipSubscription, DeleteOpenIdConnection, DeletePlayerSharedSecret, DeleteSegment, DeleteTask, DeleteTitle, DeleteTitleDataOverride, ExportMasterPlayerData, ExportPlayersInSegment, GetActionsOnPlayersInSegmentTaskInstance, GetAllSegments, GetCloudScriptAzureFunctionsTaskInstance, GetCloudScriptTaskInstance, GetContentList, GetContentUploadUrl, GetDataReport, GetEventSinks, GetIPBansForIP, GetIPBansForTitle, GetPlayedTitleList, GetPlayerIdFromAuthToken, GetPlayerSharedSecrets, GetPolicy, GetRandomResultTables, GetSegmentExport, GetSegmentPlayerCount, GetSegments, GetStoreMetrics, GetTaskInstances, GetTasks, GrantItemsToUsers, IncrementLimitedEditionItemAvailability, ListOpenIdConnection, RefundPurchase, ResetPassword, ResetUserStatistics, ResolvePurchaseDispute, RevokeBans, RevokeIPBan, RunTask, SendAccountRecoveryEmail, SetEventSink, SetMembershipOverride, SetPlayerSecret, SetTitleDataAndOverrides, SetupPushNotification, UpdateBans, UpdateIPBan, UpdateOpenIdConnection, UpdatePlayerSharedSecret, UpdatePolicy, UpdateRandomResultTables, UpdateSegment, UpdateTask, ValidateApiPolicy

## Group

Working: `AcceptGroupApplication`, `AcceptGroupInvitation`, `AddMembers`, `ApplyToGroup`, `BlockEntity`, `ChangeMemberRole`, `CreateGroup`, `CreateRole`, `DeleteGroup`, `DeleteRole`, `GetGroup`, `InviteToGroup`, `IsMember`, `ListGroupApplications`, `ListGroupBlocks`, `ListGroupInvitations`, `ListGroupMembers`, `ListMembership`, `ListMembershipOpportunities`, `RemoveGroupApplication`, `RemoveGroupInvitation`, `RemoveMembers`, `UnblockEntity`, `UpdateGroup`, `UpdateRole`

## Match

Working: `CancelAllMatchmakingTicketsForPlayer`, `CancelMatchmakingTicket`, `CreateMatchmakingTicket`, `CreateServerMatchmakingTicket`, `GetMatch`, `GetMatchmakingQueue`, `GetMatchmakingTicket`, `GetQueueStatistics`, `JoinMatchmakingTicket`, `ListMatchmakingQueues`, `ListMatchmakingTicketsForPlayer`, `RemoveMatchmakingQueue`, `SetMatchmakingQueue`

Not yet: CancelAllServerBackfillTicketsForPlayer, CancelServerBackfillTicket, CreateServerBackfillTicket, GetServerBackfillTicket, ListServerBackfillTicketsForPlayer, SubscribeToMatchmakingResource, UnsubscribeFromMatchmakingResource

## Profile

Working: `GetProfile`, `GetProfiles`, `GetTitlePlayersFromMasterPlayerAccountIds`, `SetDisplayName`, `SetProfileLanguage`

Not yet: GetGlobalPolicy, GetTitlePlayersFromXboxLiveIDs, SetAvatarUrl, SetGlobalPolicy, SetProfilePolicy

## File

Working: `AbortFileUploads`, `DeleteFiles`, `FinalizeFileUploads`, `GetFiles`, `InitiateFileUploads`

## Event

Working: `WriteEvents`, `WriteTelemetryEvents`

Not yet: CreateTelemetryKey, DeleteDataConnection, DeleteEventSamplingRatio, DeleteTelemetryKey, GetDataConnection, GetEventSamplingRatio, GetEventSamplingRatios, GetTelemetryKey, ListDataConnections, ListTelemetryKeys, SetDataConnection, SetDataConnectionActive, SetEventSamplingRatio, SetTelemetryKeyActive

## Authentication

Working: `GetEntityToken`, `ValidateEntityToken`

## Object

Working: `GetObjects`, `SetObjects`

## CloudScript

Working: `ExecuteEntityCloudScript`

Not yet: ExecuteFunction, GetFunction, ListEventHubFunctions, ListFunctions, ListHttpFunctions, ListQueuedFunctions, PostFunctionResultForEntityTriggeredAction, PostFunctionResultForFunctionExecution, PostFunctionResultForPlayerTriggeredAction, PostFunctionResultForScheduledTask, RegisterEventHubFunction, RegisterHttpFunction, RegisterQueuedFunction, UnregisterFunction

## MultiplayerServer

Not yet: CreateBuildAlias, CreateBuildWithCustomContainer, CreateBuildWithManagedContainer, CreateBuildWithProcessBasedServer, CreateRemoteUser, CreateTitleMultiplayerServersQuotaChange, DeleteAsset, DeleteBuild, DeleteBuildAlias, DeleteBuildRegion, DeleteCertificate, DeleteContainerImageRepository, DeleteRemoteUser, DeleteSecret, EnableMultiplayerServersForTitle, GetAssetDownloadUrl, GetAssetUploadUrl, GetBuild, GetBuildAlias, GetCognitiveServicesLocales, GetCognitiveServicesToken, GetContainerRegistryCredentials, GetMultiplayerServerAndToken, GetMultiplayerServerDetails, GetMultiplayerServerLogs, GetMultiplayerSessionLogsBySessionId, GetRemoteLoginEndpoint, GetTitleEnabledForMultiplayerServersStatus, GetTitleMultiplayerServersQuotaChange, GetTitleMultiplayerServersQuotas, ListArchivedMultiplayerServers, ListAssetSummaries, ListBuildAliases, ListBuildSummariesV2, ListCertificateSummaries, ListContainerImages, ListContainerImageTags, ListMultiplayerServers, ListPartyQosServers, ListQosServersForTitle, ListSecretSummaries, ListTitleMultiplayerServersQuotaChanges, ListVirtualMachineSummaries, RequestMultiplayerServer, RequestMultiplayerServerAndToken, RolloverContainerRegistryCredentials, ShutdownMultiplayerServer, UntagContainerImage, UpdateBuildAlias, UpdateBuildName, UpdateBuildRegion, UpdateBuildRegions, UploadCertificate, UploadSecret

## Addon

Not yet: ConfigurePSNEventStreams, CreateOrUpdateApple, CreateOrUpdateFacebook, CreateOrUpdateFacebookInstantGames, CreateOrUpdateGoogle, CreateOrUpdateKongregate, CreateOrUpdateNintendo, CreateOrUpdatePSN, CreateOrUpdateSteam, CreateOrUpdateToxMod, CreateOrUpdateTwitch, DeleteApple, DeleteFacebook, DeleteFacebookInstantGames, DeleteGoogle, DeleteKongregate, DeleteNintendo, DeletePSN, DeleteSteam, DeleteToxMod, DeleteTwitch, GetApple, GetFacebook, GetFacebookInstantGames, GetGoogle, GetKongregate, GetNintendo, GetPSN, GetSteam, GetToxMod, GetTwitch

## Catalog

Not yet: CreateDraftItem, CreateUploadUrls, CreateView, DeleteEntityItemReviews, DeleteItem, DeleteView, GetCatalogConfig, GetDraftItem, GetDraftItems, GetEntityDraftItems, GetEntityItemReview, GetItem, GetItemContainers, GetItemModerationState, GetItemPublishStatus, GetItemReviews, GetItemReviewSummary, GetItems, GetView, GetViews, PublishDraftItem, ReportItem, ReportItemReview, ReviewItem, SearchItems, SetItemModerationState, SubmitItemReviewVote, TakedownItemReviews, UpdateCatalogConfig, UpdateDraftItem, UpdateView

## Inventory

Not yet: AddInventoryItems, DeleteInventoryCollection, DeleteInventoryItems, ExecuteInventoryOperations, ExecuteTransferOperations, GetInventoryCollectionIds, GetInventoryItems, GetInventoryOperationStatus, GetTransactionHistory, PurchaseInventoryItems, RedeemAppleAppStoreInventoryItems, RedeemAppleAppStoreWithJwsInventoryItems, RedeemGooglePlayInventoryItems, RedeemMicrosoftStoreInventoryItems, RedeemNintendoEShopInventoryItems, RedeemPlayStationStoreInventoryItems, RedeemSteamInventoryItems, SubtractInventoryItems, TransferInventoryItems, UpdateInventoryItems

## TrueSkill

Not yet: CancelModel, CreateBaseModel, CreateBatchModel, CreateScenario, DeactivateModel, DeleteModel, DeleteScenario, GetModelDetails, GetModelsByScenario, GetPlayerSkill, GetPlayerSkillForConditions, GetPlayerSkillForConditionsFromModel, GetPlayerSkillFromModel, GetScenarioConfiguration, GetScenarioConfigurations, UpdateModel, UpdatePrimaryModel, UpdateScenarioConfiguration, UploadMatchResult

## Lobby

Not yet: CreateLobby, DeleteLobby, FindFriendLobbies, FindLobbies, GetLobby, InviteToLobby, JoinArrangedLobby, JoinLobby, JoinLobbyAsServer, LeaveLobby, LeaveLobbyAsServer, RemoveMember, SubscribeToLobbyResource, UnsubscribeFromLobbyResource, UpdateLobby, UpdateLobbyAsServer

## Experimentation

Not yet: CreateExclusionGroup, CreateExperiment, DeleteExclusionGroup, DeleteExperiment, GetExclusionGroups, GetExclusionGroupTraffic, GetExperiments, GetLatestScorecard, GetTreatmentAssignment, StartExperiment, StopExperiment, UpdateExclusionGroup, UpdateExperiment

## Leaderboard

Not yet: CreateLeaderboardDefinition, DeleteLeaderboardDefinition, DeleteLeaderboardEntries, GetFriendLeaderboardForEntity, GetLeaderboard, GetLeaderboardAroundEntity, GetLeaderboardDefinition, GetLeaderboardForEntities, IncrementLeaderboardVersion, ListLeaderboardDefinitions, UnlinkLeaderboardFromStatistic, UpdateLeaderboardEntries, UpdateLeaderboardDefinition

## Statistic

Not yet: CreateStatisticDefinition, DeleteStatisticDefinition, DeleteStatistics, GetStatisticDefinition, GetStatistics, GetStatisticsForEntities, IncrementStatisticVersion, ListStatisticDefinitions, UpdateStatistics, UnlinkAggregationSourceFromStatistic, UpdateStatisticDefinition

## StateShare

Not yet: CreateLinkForState, CreateState, DeleteLinkForState, DeleteState, GetLinkMetadata, GetState, ListStateIds

## VersionedCatalog

Not yet: CompleteVersionedCatalogUpload, CreateVersionedCatalogUploadURL, DeleteVersionedCatalog, ExportVersionedCatalog, GetVersionedCatalogItem, GetVersionedCatalogUploadStatus, ListVersionedCatalogs

## Insights

Not yet: GetDetails, GetLimits, GetOperationStatus, GetPendingOperations, SetPerformance, SetStorageRetention

## Party

Not yet: EnablePartiesForTitle, RequestParty, RequestPartyService

## GameServerIdentity

Not yet: AuthenticateGameServerWithCustomId, Delete

## Sweepstakes

Not yet: CreateSweepstake, GetSweepstake

## Locale

Not yet: GetLanguageList

