// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_WEBSITE_SETTINGS_MOCK_PERMISSION_BUBBLE_REQUEST_H_
#define CHROME_BROWSER_UI_WEBSITE_SETTINGS_MOCK_PERMISSION_BUBBLE_REQUEST_H_

#include "base/strings/string16.h"
#include "chrome/browser/ui/website_settings/permission_bubble_request.h"
#include "url/gurl.h"

class MockPermissionBubbleRequest : public PermissionBubbleRequest {
 public:
  MockPermissionBubbleRequest();
  explicit MockPermissionBubbleRequest(const std::string& text);
  explicit MockPermissionBubbleRequest(const std::string& text,
                                       const GURL& url);
  explicit MockPermissionBubbleRequest(const std::string& text,
                                       const std::string& accept_label,
                                       const std::string& deny_label);
  virtual ~MockPermissionBubbleRequest();

  virtual int GetIconID() const override;
  virtual base::string16 GetMessageText() const override;
  virtual base::string16 GetMessageTextFragment() const override;
  virtual bool HasUserGesture() const override;
  virtual GURL GetRequestingHostname() const override;

  virtual void PermissionGranted() override;
  virtual void PermissionDenied() override;
  virtual void Cancelled() override;
  virtual void RequestFinished() override;

  bool granted();
  bool cancelled();
  bool finished();

  void SetHasUserGesture();

 private:
  bool granted_;
  bool cancelled_;
  bool finished_;
  bool user_gesture_;

  base::string16 text_;
  base::string16 accept_label_;
  base::string16 deny_label_;
  GURL hostname_;
};

#endif  // CHROME_BROWSER_UI_WEBSITE_SETTINGS_MOCK_PERMISSION_BUBBLE_REQUEST_H_
