// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "device/battery/battery_status_manager.h"

#include "base/memory/ref_counted.h"
#include "chromeos/dbus/dbus_thread_manager.h"
#include "chromeos/dbus/power_manager/power_supply_properties.pb.h"
#include "chromeos/dbus/power_manager_client.h"

namespace device {

namespace {

class PowerManagerObserver
    : public chromeos::PowerManagerClient::Observer,
      public base::RefCountedThreadSafe<PowerManagerObserver> {
 public:
  explicit PowerManagerObserver(
      const BatteryStatusService::BatteryUpdateCallback& callback)
      : callback_(callback), currently_listening_(false) {}

  // Starts listening for updates.
  void Start() {
    if (currently_listening_)
      return;
    chromeos::PowerManagerClient* power_client =
        chromeos::DBusThreadManager::Get()->GetPowerManagerClient();
    power_client->AddObserver(this);
    power_client->RequestStatusUpdate();
    currently_listening_ = true;
  }

  // Stops listening for updates.
  void Stop() {
    if (!currently_listening_)
      return;
    chromeos::DBusThreadManager::Get()->GetPowerManagerClient()->RemoveObserver(
        this);
    currently_listening_ = false;
  }

 private:
  friend class base::RefCountedThreadSafe<PowerManagerObserver>;

  ~PowerManagerObserver() override {}

  bool IsBatteryPresent(
      const power_manager::PowerSupplyProperties& proto) const {
    return proto.battery_state() !=
           power_manager::PowerSupplyProperties_BatteryState_NOT_PRESENT;
  }

  bool IsUsbChargerConnected(
      const power_manager::PowerSupplyProperties& proto) const {
    return proto.external_power() ==
           power_manager::PowerSupplyProperties_ExternalPower_USB;
  }

  bool IsBatteryCharging(
      const power_manager::PowerSupplyProperties& proto) const {
    return proto.battery_state() !=
           power_manager::PowerSupplyProperties_BatteryState_DISCHARGING;
  }

  bool IsBatteryFull(const power_manager::PowerSupplyProperties& proto) const {
    return proto.battery_state() ==
           power_manager::PowerSupplyProperties_BatteryState_FULL;
  }

  double GetBatteryLevel(
      const power_manager::PowerSupplyProperties& proto) const {
    const double kMaxBatteryLevelProto = 100.f;
    return proto.battery_percent() / kMaxBatteryLevelProto;
  }

  // chromeos::PowerManagerClient::Observer:
  void PowerChanged(
      const power_manager::PowerSupplyProperties& proto) override {
    BatteryStatus status;

    // Use the default values if there is no battery in the system.
    if (IsBatteryPresent(proto)) {
      // The charging status is unreliable if a low power charger is connected
      // (i.e. usb).
      bool status_unreliable = IsUsbChargerConnected(proto);
      // Battery time is unreliable if it is still being computed.
      bool time_unreliable =
          status_unreliable || proto.is_calculating_battery_time();

      // Set |charging| only if the status is reliable. Otherwise, keep the
      // default (which is |true|).
      if (!status_unreliable)
        status.charging = IsBatteryCharging(proto);

      // Set |chargingTime| to +infinity if the battery is discharging, or if
      // the time is unreliable. Keep the default value (which is 0) if the
      // battery is full.
      if (time_unreliable || !status.charging)
        status.charging_time = std::numeric_limits<double>::infinity();
      else if (!IsBatteryFull(proto))
        status.charging_time = proto.battery_time_to_full_sec();

      // Keep the default value for |dischargingTime| (which is +infinity) if
      // the time is unreliable, or if the battery is charging.
      if (!time_unreliable && !status.charging)
        status.discharging_time = proto.battery_time_to_empty_sec();

      status.level = GetBatteryLevel(proto);
    }
    callback_.Run(status);
  }

  BatteryStatusService::BatteryUpdateCallback callback_;
  bool currently_listening_;

  DISALLOW_COPY_AND_ASSIGN(PowerManagerObserver);
};

class BatteryStatusManagerChromeOS
    : public BatteryStatusManager,
      public chromeos::PowerManagerClient::Observer {
 public:
  explicit BatteryStatusManagerChromeOS(
      const BatteryStatusService::BatteryUpdateCallback& callback)
      : observer_(new PowerManagerObserver(callback)) {}

  ~BatteryStatusManagerChromeOS() override { observer_->Stop(); }

 private:
  // BatteryStatusManager:
  bool StartListeningBatteryChange() override {
    observer_->Start();
    return true;
  }

  void StopListeningBatteryChange() override { observer_->Stop(); }

  scoped_refptr<PowerManagerObserver> observer_;

  DISALLOW_COPY_AND_ASSIGN(BatteryStatusManagerChromeOS);
};

}  // namespace

// static
scoped_ptr<BatteryStatusManager> BatteryStatusManager::Create(
    const BatteryStatusService::BatteryUpdateCallback& callback) {
  return scoped_ptr<BatteryStatusManager>(
      new BatteryStatusManagerChromeOS(callback));
}

}  // namespace device
