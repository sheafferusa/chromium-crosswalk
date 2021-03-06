#!/usr/bin/env python
# Copyright 2014 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

"""Generational ClusterFuzz fuzzer. It generates IPC messages using
GenerateTraits. Support of GenerateTraits for different types will be gradually
added.
"""

import os
import random
import subprocess
import sys
import utils

IPC_GENERATE_APPLICATION = 'ipc_fuzzer_generate'
IPC_REPLAY_APPLICATION = 'ipc_fuzzer_replay'
MAX_IPC_MESSAGES_PER_TESTCASE = 1500


class GenerationalFuzzer:
  def parse_arguments(self):
    self.args = utils.parse_arguments()

  def set_application_paths(self):
    chrome_application_path = utils.get_application_path()
    chrome_application_directory = os.path.dirname(chrome_application_path)
    self.ipc_generate_binary = utils.application_name_for_platform(
        IPC_GENERATE_APPLICATION)
    self.ipc_replay_binary = utils.application_name_for_platform(
        IPC_REPLAY_APPLICATION)
    self.ipc_generate_binary_path = os.path.join(
        chrome_application_directory, self.ipc_generate_binary)
    self.ipc_replay_binary_path = os.path.join(
        chrome_application_directory, self.ipc_replay_binary)

  def generate_ipcdump_testcase(self):
    ipcdump_testcase_path = (
        utils.random_ipcdump_testcase_path(self.args.output_dir))
    num_ipc_messages = random.randint(1, MAX_IPC_MESSAGES_PER_TESTCASE)
    count_option = '--count=%d' % num_ipc_messages

    cmd = [self.ipc_generate_binary_path, count_option, ipcdump_testcase_path]

    if subprocess.call(cmd):
      sys.exit('%s failed.' % self.ipc_generate_binary)

    utils.create_flags_file(ipcdump_testcase_path, self.ipc_replay_binary_path)

  def main(self):
    self.parse_arguments()
    self.set_application_paths()
    for _ in xrange(self.args.no_of_files):
      self.generate_ipcdump_testcase()

    return 0

if __name__ == "__main__":
  fuzzer = GenerationalFuzzer()
  sys.exit(fuzzer.main())
