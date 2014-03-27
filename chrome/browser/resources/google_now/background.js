// Copyright (c) 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

/**
 * @fileoverview The event page for Google Now for Chrome implementation.
 * The Google Now event page gets Google Now cards from the server and shows
 * them as Chrome notifications.
 * The service performs periodic updating of Google Now cards.
 * Each updating of the cards includes 4 steps:
 * 1. Processing requests for cards dismissals that are not yet sent to the
 *    server.
 * 2. Making a server request.
 * 3. Showing the received cards as notifications.
 */

// TODO(vadimt): Decide what to do in incognito mode.
// TODO(vadimt): Figure out the final values of the constants.

/**
 * Standard response code for successful HTTP requests. This is the only success
 * code the server will send.
 */
var HTTP_OK = 200;
var HTTP_NOCONTENT = 204;

var HTTP_BAD_REQUEST = 400;
var HTTP_UNAUTHORIZED = 401;
var HTTP_FORBIDDEN = 403;
var HTTP_METHOD_NOT_ALLOWED = 405;

var MS_IN_SECOND = 1000;
var MS_IN_MINUTE = 60 * 1000;

/**
 * Initial period for polling for Google Now Notifications cards to use when the
 * period from the server is not available.
 */
var INITIAL_POLLING_PERIOD_SECONDS = 5 * 60;  // 5 minutes

/**
 * Mininal period for polling for Google Now Notifications cards.
 */
var MINIMUM_POLLING_PERIOD_SECONDS = 5 * 60;  // 5 minutes

/**
 * Maximal period for polling for Google Now Notifications cards to use when the
 * period from the server is not available.
 */
var MAXIMUM_POLLING_PERIOD_SECONDS = 60 * 60;  // 1 hour

/**
 * Initial period for retrying the server request for dismissing cards.
 */
var INITIAL_RETRY_DISMISS_PERIOD_SECONDS = 60;  // 1 minute

/**
 * Maximum period for retrying the server request for dismissing cards.
 */
var MAXIMUM_RETRY_DISMISS_PERIOD_SECONDS = 60 * 60;  // 1 hour

/**
 * Time we keep retrying dismissals.
 */
var MAXIMUM_DISMISSAL_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Time we keep dismissals after successful server dismiss requests.
 */
var DISMISS_RETENTION_TIME_MS = 20 * 60 * 1000;  // 20 minutes

/**
 * Default period for checking whether the user is opted in to Google Now.
 */
var DEFAULT_OPTIN_CHECK_PERIOD_SECONDS = 60 * 60 * 24 * 7; // 1 week

/**
 * URL to open when the user clicked on a link for the our notification
 * settings.
 */
var SETTINGS_URL = 'https://support.google.com/chrome/?p=ib_google_now_welcome';

/**
 * Number of cards that need an explanatory link.
 */
var EXPLANATORY_CARDS_LINK_THRESHOLD = 4;

/**
 * Names for tasks that can be created by the extension.
 */
var UPDATE_CARDS_TASK_NAME = 'update-cards';
var DISMISS_CARD_TASK_NAME = 'dismiss-card';
var RETRY_DISMISS_TASK_NAME = 'retry-dismiss';
var STATE_CHANGED_TASK_NAME = 'state-changed';
var SHOW_ON_START_TASK_NAME = 'show-cards-on-start';
var ON_PUSH_MESSAGE_START_TASK_NAME = 'on-push-message';

/**
 * Group as received from the server.
 *
 * @typedef {{
 *   nextPollSeconds: (string|undefined),
 *   rank: (number|undefined),
 *   requested: (boolean|undefined)
 * }}
 */
var ReceivedGroup;

/**
 * Server response with notifications and groups.
 *
 * @typedef {{
 *   googleNowDisabled: (boolean|undefined),
 *   groups: Object.<string, ReceivedGroup>,
 *   notifications: Array.<ReceivedNotification>
 * }}
 */
var ServerResponse;

/**
 * Notification group as the client stores it. |cardsTimestamp| and |rank| are
 * defined if |cards| is non-empty. |nextPollTime| is undefined if the server
 * (1) never sent 'nextPollSeconds' for the group or
 * (2) didn't send 'nextPollSeconds' with the last group update containing a
 *     cards update and all the times after that.
 *
 * @typedef {{
 *   cards: Array.<ReceivedNotification>,
 *   cardsTimestamp: (number|undefined),
 *   nextPollTime: (number|undefined),
 *   rank: (number|undefined)
 * }}
 */
var StoredNotificationGroup;

/**
 * Pending (not yet successfully sent) dismissal for a received notification.
 * |time| is the moment when the user requested dismissal.
 *
 * @typedef {{
 *   chromeNotificationId: ChromeNotificationId,
 *   time: number,
 *   dismissalData: DismissalData
 * }}
 */
var PendingDismissal;

/**
 * Checks if a new task can't be scheduled when another task is already
 * scheduled.
 * @param {string} newTaskName Name of the new task.
 * @param {string} scheduledTaskName Name of the scheduled task.
 * @return {boolean} Whether the new task conflicts with the existing task.
 */
function areTasksConflicting(newTaskName, scheduledTaskName) {
  if (newTaskName == UPDATE_CARDS_TASK_NAME &&
      scheduledTaskName == UPDATE_CARDS_TASK_NAME) {
    // If a card update is requested while an old update is still scheduled, we
    // don't need the new update.
    return true;
  }

  if (newTaskName == RETRY_DISMISS_TASK_NAME &&
      (scheduledTaskName == UPDATE_CARDS_TASK_NAME ||
       scheduledTaskName == DISMISS_CARD_TASK_NAME ||
       scheduledTaskName == RETRY_DISMISS_TASK_NAME)) {
    // No need to schedule retry-dismiss action if another action that tries to
    // send dismissals is scheduled.
    return true;
  }

  return false;
}

var tasks = buildTaskManager(areTasksConflicting);

// Add error processing to API calls.
wrapper.instrumentChromeApiFunction('metricsPrivate.getVariationParams', 1);
wrapper.instrumentChromeApiFunction('notifications.clear', 1);
wrapper.instrumentChromeApiFunction('notifications.create', 2);
wrapper.instrumentChromeApiFunction('notifications.getPermissionLevel', 0);
wrapper.instrumentChromeApiFunction('notifications.update', 2);
wrapper.instrumentChromeApiFunction('notifications.getAll', 0);
wrapper.instrumentChromeApiFunction(
    'notifications.onButtonClicked.addListener', 0);
wrapper.instrumentChromeApiFunction('notifications.onClicked.addListener', 0);
wrapper.instrumentChromeApiFunction('notifications.onClosed.addListener', 0);
wrapper.instrumentChromeApiFunction(
    'notifications.onPermissionLevelChanged.addListener', 0);
wrapper.instrumentChromeApiFunction(
    'notifications.onShowSettings.addListener', 0);
wrapper.instrumentChromeApiFunction('permissions.contains', 1);
wrapper.instrumentChromeApiFunction('pushMessaging.onMessage.addListener', 0);
wrapper.instrumentChromeApiFunction('runtime.onInstalled.addListener', 0);
wrapper.instrumentChromeApiFunction('runtime.onStartup.addListener', 0);
wrapper.instrumentChromeApiFunction('tabs.create', 1);

var updateCardsAttempts = buildAttemptManager(
    'cards-update',
    requestCards,
    INITIAL_POLLING_PERIOD_SECONDS,
    MAXIMUM_POLLING_PERIOD_SECONDS);
var dismissalAttempts = buildAttemptManager(
    'dismiss',
    retryPendingDismissals,
    INITIAL_RETRY_DISMISS_PERIOD_SECONDS,
    MAXIMUM_RETRY_DISMISS_PERIOD_SECONDS);
var cardSet = buildCardSet();

var authenticationManager = buildAuthenticationManager();

/**
 * Google Now UMA event identifier.
 * @enum {number}
 */
var GoogleNowEvent = {
  REQUEST_FOR_CARDS_TOTAL: 0,
  REQUEST_FOR_CARDS_SUCCESS: 1,
  CARDS_PARSE_SUCCESS: 2,
  DISMISS_REQUEST_TOTAL: 3,
  DISMISS_REQUEST_SUCCESS: 4,
  LOCATION_REQUEST: 5,
  DELETED_LOCATION_UPDATE: 6,
  EXTENSION_START: 7,
  DELETED_SHOW_WELCOME_TOAST: 8,
  STOPPED: 9,
  DELETED_USER_SUPPRESSED: 10,
  SIGNED_OUT: 11,
  NOTIFICATION_DISABLED: 12,
  GOOGLE_NOW_DISABLED: 13,
  EVENTS_TOTAL: 14  // EVENTS_TOTAL is not an event; all new events need to be
                    // added before it.
};

/**
 * Records a Google Now Event.
 * @param {GoogleNowEvent} event Event identifier.
 */
function recordEvent(event) {
  var metricDescription = {
    metricName: 'GoogleNow.Event',
    type: 'histogram-linear',
    min: 1,
    max: GoogleNowEvent.EVENTS_TOTAL,
    buckets: GoogleNowEvent.EVENTS_TOTAL + 1
  };

  chrome.metricsPrivate.recordValue(metricDescription, event);
}

/**
 * Records a notification clicked event.
 * @param {number|undefined} cardTypeId Card type ID.
 */
function recordNotificationClick(cardTypeId) {
  if (cardTypeId !== undefined) {
    chrome.metricsPrivate.recordSparseValue(
        'GoogleNow.Card.Clicked', cardTypeId);
  }
}

/**
 * Records a button clicked event.
 * @param {number|undefined} cardTypeId Card type ID.
 * @param {number} buttonIndex Button Index
 */
function recordButtonClick(cardTypeId, buttonIndex) {
  if (cardTypeId !== undefined) {
    chrome.metricsPrivate.recordSparseValue(
        'GoogleNow.Card.Button.Clicked' + buttonIndex, cardTypeId);
  }
}

/**
 * Checks the result of the HTTP Request and updates the authentication
 * manager on any failure.
 * @param {string} token Authentication token to validate against an
 *     XMLHttpRequest.
 * @return {function(XMLHttpRequest)} Function that validates the token with the
 *     supplied XMLHttpRequest.
 */
function checkAuthenticationStatus(token) {
  return function(request) {
    if (request.status == HTTP_FORBIDDEN ||
        request.status == HTTP_UNAUTHORIZED) {
      authenticationManager.removeToken(token);
    }
  }
}

/**
 * Builds and sends an authenticated request to the notification server.
 * @param {string} method Request method.
 * @param {string} handlerName Server handler to send the request to.
 * @param {string=} opt_contentType Value for the Content-type header.
 * @return {Promise} A promise to issue a request to the server.
 *     The promise rejects if there is a client-side authentication issue.
 */
function requestFromServer(method, handlerName, opt_contentType) {
  return authenticationManager.getAuthToken().then(function(token) {
    var request = buildServerRequest(method, handlerName, opt_contentType);
    request.setRequestHeader('Authorization', 'Bearer ' + token);
    var requestPromise = new Promise(function(resolve) {
      request.addEventListener('loadend', function() {
        resolve(request);
      }, false);
      request.send();
    });
    requestPromise.then(checkAuthenticationStatus(token));
    return requestPromise;
  });
}

/**
 * Shows parsed and combined cards as notifications.
 * @param {Object.<string, StoredNotificationGroup>} notificationGroups Map from
 *     group name to group information.
 * @param {Object.<ChromeNotificationId, CombinedCard>} cards Map from
 *     chromeNotificationId to the combined card, containing cards to show.
 * @param {function()} onSuccess Called on success.
 * @param {function(ReceivedNotification)=} onCardShown Optional parameter
 *     called when each card is shown.
 */
function showNotificationCards(
    notificationGroups, cards, onSuccess, onCardShown) {
  console.log('showNotificationCards ' + JSON.stringify(cards));

  instrumented.notifications.getAll(function(notifications) {
    console.log('showNotificationCards-getAll ' +
        JSON.stringify(notifications));
    notifications = notifications || {};

    // Mark notifications that didn't receive an update as having received
    // an empty update.
    for (var chromeNotificationId in notifications) {
      cards[chromeNotificationId] = cards[chromeNotificationId] || [];
    }

    /** @type {Object.<string, NotificationDataEntry>} */
    var notificationsData = {};

    // Create/update/delete notifications.
    for (var chromeNotificationId in cards) {
      notificationsData[chromeNotificationId] = cardSet.update(
          chromeNotificationId,
          cards[chromeNotificationId],
          notificationGroups,
          onCardShown);
    }
    chrome.storage.local.set({notificationsData: notificationsData});
    onSuccess();
  });
}

/**
 * Removes all cards and card state on Google Now close down.
 */
function removeAllCards() {
  console.log('removeAllCards');

  // TODO(robliao): Once Google Now clears its own checkbox in the
  // notifications center and bug 260376 is fixed, the below clearing
  // code is no longer necessary.
  instrumented.notifications.getAll(function(notifications) {
    notifications = notifications || {};
    for (var chromeNotificationId in notifications) {
      instrumented.notifications.clear(chromeNotificationId, function() {});
    }
    chrome.storage.local.remove(['notificationsData', 'notificationGroups']);
  });
}

/**
 * Adds a card group into a set of combined cards.
 * @param {Object.<ChromeNotificationId, CombinedCard>} combinedCards Map from
 *     chromeNotificationId to a combined card.
 *     This is an input/output parameter.
 * @param {StoredNotificationGroup} storedGroup Group to combine into the
 *     combined card set.
 */
function combineGroup(combinedCards, storedGroup) {
  for (var i = 0; i < storedGroup.cards.length; i++) {
    /** @type {ReceivedNotification} */
    var receivedNotification = storedGroup.cards[i];

    /** @type {UncombinedNotification} */
    var uncombinedNotification = {
      receivedNotification: receivedNotification,
      showTime: receivedNotification.trigger.showTimeSec &&
                (storedGroup.cardsTimestamp +
                 receivedNotification.trigger.showTimeSec * MS_IN_SECOND),
      hideTime: storedGroup.cardsTimestamp +
                receivedNotification.trigger.hideTimeSec * MS_IN_SECOND
    };

    var combinedCard =
        combinedCards[receivedNotification.chromeNotificationId] || [];
    combinedCard.push(uncombinedNotification);
    combinedCards[receivedNotification.chromeNotificationId] = combinedCard;
  }
}

/**
 * Schedules next cards poll.
 * @param {Object.<string, StoredNotificationGroup>} groups Map from group name
 *     to group information.
 * @param {boolean} isOptedIn True if the user is opted in to Google Now.
 */
function scheduleNextPoll(groups, isOptedIn) {
  if (isOptedIn) {
    var nextPollTime = null;

    for (var groupName in groups) {
      var group = groups[groupName];
      if (group.nextPollTime !== undefined) {
        nextPollTime = nextPollTime == null ?
            group.nextPollTime : Math.min(group.nextPollTime, nextPollTime);
      }
    }

    // At least one of the groups must have nextPollTime.
    verify(nextPollTime != null, 'scheduleNextPoll: nextPollTime is null');

    var nextPollDelaySeconds = Math.max(
        (nextPollTime - Date.now()) / MS_IN_SECOND,
        MINIMUM_POLLING_PERIOD_SECONDS);
    updateCardsAttempts.start(nextPollDelaySeconds);
  } else {
    instrumented.metricsPrivate.getVariationParams(
        'GoogleNow', function(params) {
      var optinPollPeriodSeconds =
          parseInt(params && params.optinPollPeriodSeconds, 10) ||
          DEFAULT_OPTIN_CHECK_PERIOD_SECONDS;
      updateCardsAttempts.start(optinPollPeriodSeconds);
    });
  }
}

/**
 * Combines notification groups into a set of Chrome notifications and shows
 * them.
 * @param {Object.<string, StoredNotificationGroup>} notificationGroups Map from
 *     group name to group information.
 * @param {function()} onSuccess Called on success.
 * @param {function(ReceivedNotification)=} onCardShown Optional parameter
 *     called when each card is shown.
 */
function combineAndShowNotificationCards(
    notificationGroups, onSuccess, onCardShown) {
  console.log('combineAndShowNotificationCards ' +
      JSON.stringify(notificationGroups));
  /** @type {Object.<ChromeNotificationId, CombinedCard>} */
  var combinedCards = {};

  for (var groupName in notificationGroups)
    combineGroup(combinedCards, notificationGroups[groupName]);

  showNotificationCards(
      notificationGroups, combinedCards, onSuccess, onCardShown);
}

/**
 * Based on a response from the notification server, shows notifications and
 * schedules next update.
 * @param {ServerResponse} response Server response.
 * @param {function(ReceivedNotification)=} onCardShown Optional parameter
 *     called when each card is shown.
 */
function processServerResponse(response, onCardShown) {
  console.log('processServerResponse ' + JSON.stringify(response));

  if (response.googleNowDisabled) {
    chrome.storage.local.set({googleNowEnabled: false});
    // TODO(vadimt): Remove the line below once the server stops sending groups
    // with 'googleNowDisabled' responses.
    response.groups = {};
    // Google Now was enabled; now it's disabled. This is a state change.
    onStateChange();
  }

  var receivedGroups = response.groups;

  fillFromChromeLocalStorage({
    /** @type {Object.<string, StoredNotificationGroup>} */
    notificationGroups: {},
    /** @type {Object.<NotificationId, number>} */
    recentDismissals: {}
  }).then(function(items) {
    console.log('processServerResponse-get ' + JSON.stringify(items));

    // Build a set of non-expired recent dismissals. It will be used for
    // client-side filtering of cards.
    /** @type {Object.<NotificationId, number>} */
    var updatedRecentDismissals = {};
    var now = Date.now();
    for (var notificationId in items.recentDismissals) {
      var dismissalAge = now - items.recentDismissals[notificationId];
      if (dismissalAge < DISMISS_RETENTION_TIME_MS) {
        updatedRecentDismissals[notificationId] =
            items.recentDismissals[notificationId];
      }
    }

    // Populate groups with corresponding cards.
    if (response.notifications) {
      for (var i = 0; i < response.notifications.length; ++i) {
        /** @type {ReceivedNotification} */
        var card = response.notifications[i];
        if (!(card.notificationId in updatedRecentDismissals)) {
          var group = receivedGroups[card.groupName];
          group.cards = group.cards || [];
          group.cards.push(card);
        }
      }
    }

    // Build updated set of groups.
    var updatedGroups = {};

    for (var groupName in receivedGroups) {
      var receivedGroup = receivedGroups[groupName];
      var storedGroup = items.notificationGroups[groupName] || {
        cards: [],
        cardsTimestamp: undefined,
        nextPollTime: undefined,
        rank: undefined
      };

      if (receivedGroup.requested)
        receivedGroup.cards = receivedGroup.cards || [];

      if (receivedGroup.cards) {
        // If the group contains a cards update, all its fields will get new
        // values.
        storedGroup.cards = receivedGroup.cards;
        storedGroup.cardsTimestamp = now;
        storedGroup.rank = receivedGroup.rank;
        storedGroup.nextPollTime = undefined;
        // The code below assigns nextPollTime a defined value if
        // nextPollSeconds is specified in the received group.
        // If the group's cards are not updated, and nextPollSeconds is
        // unspecified, this method doesn't change group's nextPollTime.
      }

      // 'nextPollSeconds' may be sent even for groups that don't contain
      // cards updates.
      if (receivedGroup.nextPollSeconds !== undefined) {
        storedGroup.nextPollTime =
            now + receivedGroup.nextPollSeconds * MS_IN_SECOND;
      }

      updatedGroups[groupName] = storedGroup;
    }

    scheduleNextPoll(updatedGroups, !response.googleNowDisabled);
    combineAndShowNotificationCards(
        updatedGroups,
        function() {
          chrome.storage.local.set({
            notificationGroups: updatedGroups,
            recentDismissals: updatedRecentDismissals
          });
          recordEvent(GoogleNowEvent.CARDS_PARSE_SUCCESS);
        },
        onCardShown);
  });
}

/**
 * Update the Explanatory Total Cards Shown Count.
 */
function countExplanatoryCard() {
  localStorage['explanatoryCardsShown']++;
}

/**
 * Requests notification cards from the server for specified groups.
 * @param {Array.<string>} groupNames Names of groups that need to be refreshed.
 */
function requestNotificationGroups(groupNames) {
  console.log('requestNotificationGroups from ' + NOTIFICATION_CARDS_URL +
      ', groupNames=' + JSON.stringify(groupNames));

  recordEvent(GoogleNowEvent.REQUEST_FOR_CARDS_TOTAL);

  var requestParameters = '?timeZoneOffsetMs=' +
    (-new Date().getTimezoneOffset() * MS_IN_MINUTE);

  var cardShownCallback = undefined;
  var belowExplanatoryThreshold =
      localStorage['explanatoryCardsShown'] < EXPLANATORY_CARDS_LINK_THRESHOLD;
  if (belowExplanatoryThreshold) {
    requestParameters += '&cardExplanation=true';
    cardShownCallback = countExplanatoryCard;
  }

  groupNames.forEach(function(groupName) {
    requestParameters += ('&requestTypes=' + groupName);
  });

  requestParameters += '&uiLocale=' + navigator.language;

  console.log('requestNotificationGroups: request=' + requestParameters);

  requestFromServer('GET', 'notifications' + requestParameters).then(
    function(request) {
      console.log('requestNotificationGroups-received ' + request.status);
      if (request.status == HTTP_OK) {
        recordEvent(GoogleNowEvent.REQUEST_FOR_CARDS_SUCCESS);
        processServerResponse(
            JSON.parse(request.responseText), cardShownCallback);
      }
    });
}

/**
 * Requests the account opted-in state from the server.
 * @param {function()} optedInCallback Function that will be called if
 *     opted-in state is 'true'.
 */
function requestOptedIn(optedInCallback) {
  console.log('requestOptedIn from ' + NOTIFICATION_CARDS_URL);

  requestFromServer('GET', 'settings/optin').then(function(request) {
    console.log(
        'requestOptedIn-received ' + request.status + ' ' + request.response);
    if (request.status == HTTP_OK) {
      var parsedResponse = JSON.parse(request.responseText);
      if (parsedResponse.value) {
        chrome.storage.local.set({googleNowEnabled: true});
        optedInCallback();
        // Google Now was disabled, now it's enabled. This is a state change.
        onStateChange();
      } else {
        scheduleNextPoll({}, false);
      }
    }
  });
}

/**
 * Requests notification cards from the server.
 */
function requestNotificationCards() {
  console.log('requestNotificationCards');

  fillFromChromeLocalStorage({
    /** @type {Object.<string, StoredNotificationGroup>} */
    notificationGroups: {},
    googleNowEnabled: false
  }).then(function(items) {
    console.log(
        'requestNotificationCards-storage-get ' + JSON.stringify(items));

    var groupsToRequest = [];

    var now = Date.now();

    for (var groupName in items.notificationGroups) {
      var group = items.notificationGroups[groupName];
      if (group.nextPollTime !== undefined && group.nextPollTime <= now)
        groupsToRequest.push(groupName);
    }

    if (items.googleNowEnabled) {
      requestNotificationGroups(groupsToRequest);
    } else {
      requestOptedIn(function() {
        requestNotificationGroups(groupsToRequest);
      });
    }
  });
}

/**
 * Requests and shows notification cards.
 */
function requestCards() {
  console.log('requestCards @' + new Date());
  // LOCATION_REQUEST is a legacy histogram value when we requested location.
  // This corresponds to the extension attempting to request for cards.
  // We're keeping the name the same to keep our histograms in order.
  recordEvent(GoogleNowEvent.LOCATION_REQUEST);
  tasks.add(UPDATE_CARDS_TASK_NAME, function() {
    console.log('requestCards-task-begin');
    updateCardsAttempts.isRunning(function(running) {
      if (running) {
        updateCardsAttempts.planForNext(function() {
          // The cards are requested only if there are no unsent dismissals.
          processPendingDismissals().then(requestNotificationCards);
        });
      }
    });
  });
}

/**
 * Sends a server request to dismiss a card.
 * @param {ChromeNotificationId} chromeNotificationId chrome.notifications ID of
 *     the card.
 * @param {number} dismissalTimeMs Time of the user's dismissal of the card in
 *     milliseconds since epoch.
 * @param {DismissalData} dismissalData Data to build a dismissal request.
 * @return {Promise} A promise to request the card dismissal, rejects on error.
 */
function requestCardDismissal(
    chromeNotificationId, dismissalTimeMs, dismissalData) {
  console.log('requestDismissingCard ' + chromeNotificationId +
      ' from ' + NOTIFICATION_CARDS_URL +
      ', dismissalData=' + JSON.stringify(dismissalData));

  var dismissalAge = Date.now() - dismissalTimeMs;

  if (dismissalAge > MAXIMUM_DISMISSAL_AGE_MS) {
    return Promise.resolve();
  }

  recordEvent(GoogleNowEvent.DISMISS_REQUEST_TOTAL);

  var requestParameters = 'notifications/' + dismissalData.notificationId +
      '?age=' + dismissalAge +
      '&chromeNotificationId=' + chromeNotificationId;

  for (var paramField in dismissalData.parameters)
    requestParameters += ('&' + paramField +
    '=' + dismissalData.parameters[paramField]);

  console.log('requestCardDismissal: requestParameters=' + requestParameters);

  return requestFromServer('DELETE', requestParameters).then(function(request) {
    console.log('requestDismissingCard-onloadend ' + request.status);
    if (request.status == HTTP_NOCONTENT)
      recordEvent(GoogleNowEvent.DISMISS_REQUEST_SUCCESS);

    // A dismissal doesn't require further retries if it was successful or
    // doesn't have a chance for successful completion.
    var done = request.status == HTTP_NOCONTENT ||
        request.status == HTTP_BAD_REQUEST ||
        request.status == HTTP_METHOD_NOT_ALLOWED;
    return done ? Promise.resolve() : Promise.reject();
  });
}

/**
 * Tries to send dismiss requests for all pending dismissals.
 * @return {Promise} A promise to process the pending dismissals.
 *     The promise is rejected if a problem was encountered.
 */
function processPendingDismissals() {
  return fillFromChromeLocalStorage({
    /** @type {Array.<PendingDismissal>} */
    pendingDismissals: [],
    /** @type {Object.<NotificationId, number>} */
    recentDismissals: {}
  }).then(function(items) {
    console.log(
        'processPendingDismissals-storage-get ' + JSON.stringify(items));

    var dismissalsChanged = false;

    function onFinish(success) {
      if (dismissalsChanged) {
        chrome.storage.local.set({
          pendingDismissals: items.pendingDismissals,
          recentDismissals: items.recentDismissals
        });
      }
      return success ? Promise.resolve() : Promise.reject();
    }

    function doProcessDismissals() {
      if (items.pendingDismissals.length == 0) {
        dismissalAttempts.stop();
        return onFinish(true);
      }

      // Send dismissal for the first card, and if successful, repeat
      // recursively with the rest.
      /** @type {PendingDismissal} */
      var dismissal = items.pendingDismissals[0];
      return requestCardDismissal(
          dismissal.chromeNotificationId,
          dismissal.time,
          dismissal.dismissalData).then(function() {
            dismissalsChanged = true;
            items.pendingDismissals.splice(0, 1);
            items.recentDismissals[dismissal.dismissalData.notificationId] =
                Date.now();
            return doProcessDismissals();
          }).catch(function() {
            return onFinish(false);
          });
    }

    return doProcessDismissals();
  });
}

/**
 * Submits a task to send pending dismissals.
 */
function retryPendingDismissals() {
  tasks.add(RETRY_DISMISS_TASK_NAME, function() {
    dismissalAttempts.planForNext(function() {
      processPendingDismissals();
     });
  });
}

/**
 * Opens a URL in a new tab.
 * @param {string} url URL to open.
 */
function openUrl(url) {
  instrumented.tabs.create({url: url}, function(tab) {
    if (tab)
      chrome.windows.update(tab.windowId, {focused: true});
    else
      chrome.windows.create({url: url, focused: true});
  });
}

/**
 * Opens URL corresponding to the clicked part of the notification.
 * @param {ChromeNotificationId} chromeNotificationId chrome.notifications ID of
 *     the card.
 * @param {function(NotificationDataEntry): (string|undefined)} selector
 *     Function that extracts the url for the clicked area from the
 *     notification data entry.
 */
function onNotificationClicked(chromeNotificationId, selector) {
  fillFromChromeLocalStorage({
    /** @type {Object.<string, NotificationDataEntry>} */
    notificationsData: {}
  }).then(function(items) {
    /** @type {(NotificationDataEntry|undefined)} */
    var notificationDataEntry = items.notificationsData[chromeNotificationId];
    if (!notificationDataEntry)
      return;

    var url = selector(notificationDataEntry);
    if (!url)
      return;

    openUrl(url);
  });
}

/**
 * Callback for chrome.notifications.onClosed event.
 * @param {ChromeNotificationId} chromeNotificationId chrome.notifications ID of
 *     the card.
 * @param {boolean} byUser Whether the notification was closed by the user.
 */
function onNotificationClosed(chromeNotificationId, byUser) {
  if (!byUser)
    return;

  // At this point we are guaranteed that the notification is a now card.
  chrome.metricsPrivate.recordUserAction('GoogleNow.Dismissed');

  tasks.add(DISMISS_CARD_TASK_NAME, function() {
    dismissalAttempts.start();

    fillFromChromeLocalStorage({
      /** @type {Array.<PendingDismissal>} */
      pendingDismissals: [],
      /** @type {Object.<string, NotificationDataEntry>} */
      notificationsData: {},
      /** @type {Object.<string, StoredNotificationGroup>} */
      notificationGroups: {}
    }).then(function(items) {
      /** @type {NotificationDataEntry} */
      var notificationData =
          items.notificationsData[chromeNotificationId] ||
          {
            timestamp: Date.now(),
            combinedCard: []
          };

      var dismissalResult =
          cardSet.onDismissal(
              chromeNotificationId,
              notificationData,
              items.notificationGroups);

      for (var i = 0; i < dismissalResult.dismissals.length; i++) {
        /** @type {PendingDismissal} */
        var dismissal = {
          chromeNotificationId: chromeNotificationId,
          time: Date.now(),
          dismissalData: dismissalResult.dismissals[i]
        };
        items.pendingDismissals.push(dismissal);
      }

      items.notificationsData[chromeNotificationId] =
          dismissalResult.notificationData;

      chrome.storage.local.set(items);

      processPendingDismissals();
    });
  });
}

/**
 * Initializes the polling system to start fetching cards.
 */
function startPollingCards() {
  console.log('startPollingCards');
  // Create an update timer for a case when for some reason requesting
  // cards gets stuck.
  updateCardsAttempts.start(MAXIMUM_POLLING_PERIOD_SECONDS);

  requestCards();
}

/**
 * Stops all machinery in the polling system.
 */
function stopPollingCards() {
  console.log('stopPollingCards');
  updateCardsAttempts.stop();
  removeAllCards();
  // Mark the Google Now as disabled to start with checking the opt-in state
  // next time startPollingCards() is called.
  chrome.storage.local.set({googleNowEnabled: false});
}

/**
 * Initializes the event page on install or on browser startup.
 */
function initialize() {
  recordEvent(GoogleNowEvent.EXTENSION_START);
  onStateChange();
}

/**
 * Starts or stops the polling of cards.
 * @param {boolean} shouldPollCardsRequest true to start and
 *     false to stop polling cards.
 */
function setShouldPollCards(shouldPollCardsRequest) {
  updateCardsAttempts.isRunning(function(currentValue) {
    if (shouldPollCardsRequest != currentValue) {
      console.log('Action Taken setShouldPollCards=' + shouldPollCardsRequest);
      if (shouldPollCardsRequest)
        startPollingCards();
      else
        stopPollingCards();
    } else {
      console.log(
          'Action Ignored setShouldPollCards=' + shouldPollCardsRequest);
    }
  });
}

/**
 * Enables or disables the Google Now background permission.
 * @param {boolean} backgroundEnable true to run in the background.
 *     false to not run in the background.
 */
function setBackgroundEnable(backgroundEnable) {
  instrumented.permissions.contains({permissions: ['background']},
      function(hasPermission) {
        if (backgroundEnable != hasPermission) {
          console.log('Action Taken setBackgroundEnable=' + backgroundEnable);
          if (backgroundEnable)
            chrome.permissions.request({permissions: ['background']});
          else
            chrome.permissions.remove({permissions: ['background']});
        } else {
          console.log('Action Ignored setBackgroundEnable=' + backgroundEnable);
        }
      });
}

/**
 * Record why this extension would not poll for cards.
 * @param {boolean} signedIn true if the user is signed in.
 * @param {boolean} notificationEnabled true if
 *     Google Now for Chrome is allowed to show notifications.
 * @param {boolean} googleNowEnabled true if
 *     the Google Now is enabled for the user.
 */
function recordEventIfNoCards(signedIn, notificationEnabled, googleNowEnabled) {
  if (!signedIn) {
    recordEvent(GoogleNowEvent.SIGNED_OUT);
  } else if (!notificationEnabled) {
    recordEvent(GoogleNowEvent.NOTIFICATION_DISABLED);
  } else if (!googleNowEnabled) {
    recordEvent(GoogleNowEvent.GOOGLE_NOW_DISABLED);
  }
}

/**
 * Does the actual work of deciding what Google Now should do
 * based off of the current state of Chrome.
 * @param {boolean} signedIn true if the user is signed in.
 * @param {boolean} canEnableBackground true if
 *     the background permission can be requested.
 * @param {boolean} notificationEnabled true if
 *     Google Now for Chrome is allowed to show notifications.
 * @param {boolean} googleNowEnabled true if
 *     the Google Now is enabled for the user.
 */
function updateRunningState(
    signedIn,
    canEnableBackground,
    notificationEnabled,
    googleNowEnabled) {
  console.log(
      'State Update signedIn=' + signedIn + ' ' +
      'canEnableBackground=' + canEnableBackground + ' ' +
      'notificationEnabled=' + notificationEnabled + ' ' +
      'googleNowEnabled=' + googleNowEnabled);

  var shouldPollCards = false;
  var shouldSetBackground = false;

  if (signedIn && notificationEnabled) {
    if (canEnableBackground && googleNowEnabled)
      shouldSetBackground = true;

    shouldPollCards = true;
  } else {
    recordEvent(GoogleNowEvent.STOPPED);
  }

  recordEventIfNoCards(signedIn, notificationEnabled, googleNowEnabled);

  console.log(
      'Requested Actions shouldSetBackground=' + shouldSetBackground + ' ' +
      'setShouldPollCards=' + shouldPollCards);

  setBackgroundEnable(shouldSetBackground);
  setShouldPollCards(shouldPollCards);
}

/**
 * Coordinates the behavior of Google Now for Chrome depending on
 * Chrome and extension state.
 */
function onStateChange() {
  tasks.add(STATE_CHANGED_TASK_NAME, function() {
    Promise.all([
        authenticationManager.isSignedIn(),
        canEnableBackground(),
        isNotificationsEnabled(),
        isGoogleNowEnabled()])
        .then(function(results) {
          updateRunningState.apply(null, results);
        });
  });
}

/**
 * Determines if background mode should be requested.
 * @return {Promise} A promise to determine if background can be enabled.
 */
function canEnableBackground() {
  return new Promise(function(resolve) {
    instrumented.metricsPrivate.getVariationParams(
        'GoogleNow',
        function(response) {
          resolve(!response || (response.canEnableBackground != 'false'));
        });
  });
}

/**
 * Checks if Google Now is enabled in the notifications center.
 * @return {Promise} A promise to determine if Google Now is enabled
 *     in the notifications center.
 */
function isNotificationsEnabled() {
  return new Promise(function(resolve) {
    instrumented.notifications.getPermissionLevel(function(level) {
      resolve(level == 'granted');
    });
  });
}

/**
 * Gets the previous Google Now opt-in state.
 * @return {Promise} A promise to determine the previous Google Now
 *     opt-in state.
 */
function isGoogleNowEnabled() {
  return fillFromChromeLocalStorage({googleNowEnabled: false})
      .then(function(items) {
        return items.googleNowEnabled;
      });
}

instrumented.runtime.onInstalled.addListener(function(details) {
  console.log('onInstalled ' + JSON.stringify(details));
  if (details.reason != 'chrome_update') {
    initialize();
  }
});

instrumented.runtime.onStartup.addListener(function() {
  console.log('onStartup');

  // Show notifications received by earlier polls. Doing this as early as
  // possible to reduce latency of showing first notifications. This mimics how
  // persistent notifications will work.
  tasks.add(SHOW_ON_START_TASK_NAME, function() {
    fillFromChromeLocalStorage({
      /** @type {Object.<string, StoredNotificationGroup>} */
      notificationGroups: {}
    }).then(function(items) {
      console.log('onStartup-get ' + JSON.stringify(items));

      combineAndShowNotificationCards(items.notificationGroups, function() {
        chrome.storage.local.set(items);
      });
    });
  });

  initialize();
});

authenticationManager.addListener(function() {
  console.log('signIn State Change');
  onStateChange();
});

instrumented.notifications.onClicked.addListener(
    function(chromeNotificationId) {
      chrome.metricsPrivate.recordUserAction('GoogleNow.MessageClicked');
      onNotificationClicked(chromeNotificationId,
          function(notificationDataEntry) {
            var actionUrls = notificationDataEntry.actionUrls;
            var url = actionUrls && actionUrls.messageUrl;
            if (url) {
              recordNotificationClick(notificationDataEntry.cardTypeId);
            }
            return url;
          });
        });

instrumented.notifications.onButtonClicked.addListener(
    function(chromeNotificationId, buttonIndex) {
      chrome.metricsPrivate.recordUserAction(
          'GoogleNow.ButtonClicked' + buttonIndex);
      onNotificationClicked(chromeNotificationId,
          function(notificationDataEntry) {
            var actionUrls = notificationDataEntry.actionUrls;
            var url = actionUrls.buttonUrls[buttonIndex];
            if (url) {
              recordButtonClick(notificationDataEntry.cardTypeId, buttonIndex);
            } else {
              verify(false, 'onButtonClicked: no url for a button');
            }
            return url;
          });
        });

instrumented.notifications.onClosed.addListener(onNotificationClosed);

instrumented.notifications.onPermissionLevelChanged.addListener(
    function(permissionLevel) {
      console.log('Notifications permissionLevel Change');
      onStateChange();
    });

instrumented.notifications.onShowSettings.addListener(function() {
  openUrl(SETTINGS_URL);
});

instrumented.pushMessaging.onMessage.addListener(function(message) {
  // message.payload will be '' when the extension first starts.
  // Each time after signing in, we'll get latest payload for all channels.
  // So, we need to poll the server only when the payload is non-empty and has
  // changed.
  console.log('pushMessaging.onMessage ' + JSON.stringify(message));
  if (message.payload.indexOf('REQUEST_CARDS') == 0) {
    tasks.add(ON_PUSH_MESSAGE_START_TASK_NAME, function() {
      // Accept promise rejection on failure since it's safer to do nothing,
      // preventing polling the server when the payload really didn't change.
      fillFromChromeLocalStorage({
        lastPollNowPayloads: {},
        /** @type {Object.<string, StoredNotificationGroup>} */
        notificationGroups: {}
      }, PromiseRejection.ALLOW).then(function(items) {
        if (items.lastPollNowPayloads[message.subchannelId] !=
            message.payload) {
          items.lastPollNowPayloads[message.subchannelId] = message.payload;

          items.notificationGroups['PUSH' + message.subchannelId] = {
            cards: [],
            nextPollTime: Date.now()
          };

          chrome.storage.local.set({
            lastPollNowPayloads: items.lastPollNowPayloads,
            notificationGroups: items.notificationGroups
          });

          requestCards();
        }
      });
    });
  }
});
