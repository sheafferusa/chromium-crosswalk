// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_MESSAGING_NATIVE_MESSAGE_PROCESS_HOST_H_
#define CHROME_BROWSER_EXTENSIONS_API_MESSAGING_NATIVE_MESSAGE_PROCESS_HOST_H_

#include <queue>
#include <string>

#include "base/files/file.h"
#include "base/memory/scoped_ptr.h"
#include "base/message_loop/message_loop.h"
#include "base/process/process.h"
#include "chrome/browser/extensions/api/messaging/native_process_launcher.h"
#include "extensions/browser/api/messaging/native_message_host.h"
#include "ui/gfx/native_widget_types.h"

namespace net {

class DrainableIOBuffer;
class FileStream;
class IOBuffer;
class IOBufferWithSize;

}  // namespace net

namespace extensions {

// Manages the native side of a connection between an extension and a native
// process.
//
// This class must only be created, called, and deleted on the IO thread.
// Public methods typically accept callbacks which will be invoked on the UI
// thread.
class NativeMessageProcessHost :
#if defined(OS_POSIX)
    public base::MessageLoopForIO::Watcher,
#endif  // !defined(OS_POSIX)
    public NativeMessageHost {
 public:
  virtual ~NativeMessageProcessHost();

  // Create using specified |launcher|. Used in tests.
  static scoped_ptr<NativeMessageHost> CreateWithLauncher(
      const std::string& source_extension_id,
      const std::string& native_host_name,
      scoped_ptr<NativeProcessLauncher> launcher);

  // extensions::NativeMessageHost implementation.
  virtual void OnMessage(const std::string& message) override;
  virtual void Start(Client* client) override;
  virtual scoped_refptr<base::SingleThreadTaskRunner> task_runner()
      const override;

#if defined(OS_POSIX)
  // MessageLoopForIO::Watcher interface
  virtual void OnFileCanReadWithoutBlocking(int fd) override;
  virtual void OnFileCanWriteWithoutBlocking(int fd) override;
#endif  // !defined(OS_POSIX)

  // Try and read a single message from |read_file_|. This should only be called
  // in unittests when you know there is data in the file.
  void ReadNowForTesting();

 private:
  NativeMessageProcessHost(const std::string& source_extension_id,
                           const std::string& native_host_name,
                           scoped_ptr<NativeProcessLauncher> launcher);

  // Starts the host process.
  void LaunchHostProcess();

  // Callback for NativeProcessLauncher::Launch().
  void OnHostProcessLaunched(NativeProcessLauncher::LaunchResult result,
                             base::ProcessHandle process_handle,
                             base::File read_file,
                             base::File write_file);

  // Helper methods to read incoming messages.
  void WaitRead();
  void DoRead();
  void OnRead(int result);
  void HandleReadResult(int result);
  void ProcessIncomingData(const char* data, int data_size);

  // Helper methods to write outgoing messages.
  void DoWrite();
  void HandleWriteResult(int result);
  void OnWritten(int result);

  // Closes the connection. Called from OnError() and destructor.
  void Close(const std::string& error_message);

  // The Client messages will be posted to. Should only be accessed from the
  // UI thread.
  Client* client_;

  // ID of the calling extension.
  std::string source_extension_id_;

  // Name of the native messaging host.
  std::string native_host_name_;

  // Launcher used to launch the native process.
  scoped_ptr<NativeProcessLauncher> launcher_;

  // Set to true after the native messaging connection has been stopped, e.g.
  // due to an error.
  bool closed_;

  base::ProcessHandle process_handle_;

  // Input stream reader.
  scoped_ptr<net::FileStream> read_stream_;

#if defined(OS_POSIX)
  base::PlatformFile read_file_;
  base::MessageLoopForIO::FileDescriptorWatcher read_watcher_;
#endif  // !defined(OS_POSIX)

  // Write stream.
  scoped_ptr<net::FileStream> write_stream_;

  // Read buffer passed to FileStream::Read().
  scoped_refptr<net::IOBuffer> read_buffer_;

  // Set to true when a read is pending.
  bool read_pending_;

  // Buffer for incomplete incoming messages.
  std::string incoming_data_;

  // Queue for outgoing messages.
  std::queue<scoped_refptr<net::IOBufferWithSize> > write_queue_;

  // The message that's currently being sent.
  scoped_refptr<net::DrainableIOBuffer> current_write_buffer_;

  // Set to true when a write is pending.
  bool write_pending_;

  scoped_refptr<base::SingleThreadTaskRunner> task_runner_;

  DISALLOW_COPY_AND_ASSIGN(NativeMessageProcessHost);
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_MESSAGING_NATIVE_MESSAGE_PROCESS_HOST_H_
