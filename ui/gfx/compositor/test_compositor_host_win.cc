// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/gfx/compositor/test_compositor_host.h"

#include "base/compiler_specific.h"
#include "ui/base/win/window_impl.h"
#include "ui/gfx/compositor/compositor.h"

namespace ui {

class TestCompositorHostWin : public TestCompositorHost,
                              public ui::WindowImpl {
 public:
  TestCompositorHostWin(const gfx::Rect& bounds,
                        TestCompositorHostDelegate* delegate)
      : delegate_(delegate) {
    Init(NULL, bounds);
    compositor_ = ui::Compositor::Create(hwnd(), GetSize());
  }

  virtual ~TestCompositorHostWin() {
    DestroyWindow(hwnd());
  }

  // Overridden from MessageLoop::Dispatcher:
  virtual bool Dispatch(const MSG& msg) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
    return true;
  }

  // Overridden from TestCompositorHost:
  virtual void Show() OVERRIDE {
    ShowWindow(hwnd(), SW_SHOWNORMAL);
  }
  virtual ui::Compositor* GetCompositor() OVERRIDE {
    return compositor_;
  }

 private:
  BEGIN_MSG_MAP_EX(TestCompositorHostWin)
    MSG_WM_PAINT(OnPaint)
  END_MSG_MAP()

  void OnPaint(HDC dc) {
    compositor_->NotifyStart();
    delegate_->Draw();
    compositor_->NotifyEnd();
    ValidateRect(hwnd(), NULL);
  }

  gfx::Size GetSize() {
    RECT r;
    GetClientRect(hwnd(), &r);
    return gfx::Rect(r).size();
  }

  scoped_refptr<ui::Compositor> compositor_;
  TestCompositorHostDelegate* delegate_;

  DISALLOW_COPY_AND_ASSIGN(TestCompositorHostWin);
};

TestCompositorHost* TestCompositorHost::Create(
    const gfx::Rect& bounds,
    TestCompositorHostDelegate* delegate) {
  return new TestCompositorHostWin(bounds, delegate);
}

}  // namespace ui

