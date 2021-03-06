// Copyright 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "content/browser/frame_host/frame_navigation_entry.h"

namespace content {

FrameNavigationEntry::FrameNavigationEntry() {
}

FrameNavigationEntry::FrameNavigationEntry(SiteInstanceImpl* site_instance,
                                           const GURL& url,
                                           const Referrer& referrer)
    : site_instance_(site_instance), url_(url), referrer_(referrer) {
}

FrameNavigationEntry::~FrameNavigationEntry() {
}

}  // namespace content
