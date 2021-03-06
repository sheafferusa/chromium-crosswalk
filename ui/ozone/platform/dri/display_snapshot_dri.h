// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef UI_OZONE_PLATFORM_DRI_DISPLAY_SNAPSHOT_DRI_H_
#define UI_OZONE_PLATFORM_DRI_DISPLAY_SNAPSHOT_DRI_H_

#include "base/memory/ref_counted.h"
#include "ui/display/types/display_snapshot.h"
#include "ui/ozone/platform/dri/scoped_drm_types.h"

namespace ui {

class DriWrapper;

class DisplaySnapshotDri : public DisplaySnapshot {
 public:
  DisplaySnapshotDri(const scoped_refptr<DriWrapper>& drm,
                     drmModeConnector* connector,
                     drmModeCrtc* crtc,
                     uint32_t index);
  ~DisplaySnapshotDri() override;

  scoped_refptr<DriWrapper> drm() const { return drm_; }
  // Native properties of a display used by the DRI implementation in
  // configuring this display.
  uint32_t connector() const { return connector_; }
  uint32_t crtc() const { return crtc_; }
  drmModePropertyRes* dpms_property() const { return dpms_property_.get(); }

  // DisplaySnapshot overrides:
  std::string ToString() const override;

 private:
  scoped_refptr<DriWrapper> drm_;
  uint32_t connector_;
  uint32_t crtc_;
  ScopedDrmPropertyPtr dpms_property_;
  std::string name_;
  bool overscan_flag_;

  DISALLOW_COPY_AND_ASSIGN(DisplaySnapshotDri);
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRI_DISPLAY_SNAPSHOT_DRI_H_
