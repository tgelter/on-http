// Copyright 2015, EMC, Inc.
/* jshint node:true */

'use strict';

describe('Redfish Systems Root', function () {
    var tv4;
    var validator;
    var redfish;
    var waterline;
    var Promise;
    var taskProtocol;
    var view;
    var fs;
    var nodeApi;
    var Errors;
    var racadm;
    var wsman;
    var lookup;
    var configuration;
    var mktemp = require('mktemp');

    var xmlData = `<SystemConfiguration Model=" " ServiceTag=" " TimeStamp=" ">
<Component FQDD="BIOS.Setup.1-1">
    <Attribute Name="OldSetupPassword">xxxx</Attribute>
    <Attribute Name="NewSetupPassword">xxxx</Attribute>
    <Attribute Name="PasswordStatus">Unlocked</Attribute>
</Component>

</SystemConfiguration>`;

    var nodeObm = {
        id: "574dcd5794ab6e2506fd107a",
        node: "1234abcd1234abcd1234abcd",
        service: 'ipmi-obm-service',
        config: {
            host: '1.2.3.4',
            user: 'myuser',
            password: 'mypass'
        }
    };

    var node = {
        autoDiscover: false,
        id: '1234abcd1234abcd1234abcd',
        name: 'name',
        identifiers: ['1234'],
        tags: [],
        obms: [{ obm: '/api/2.0/obms/574dcd5794ab6e2506fd107a'}],
        type: 'compute',
        relations: [
            {
                relationType: 'enclosedBy',
                targets: [ '4567efgh4567efgh4567efgh' ]
            }
        ]
    };

    var ucsNode = {
        autoDiscover: false,
        id: '5994f712d0e1e80257af9ff3',
        name: 'name',
        identifiers: ['10.240.19.70:sys/rack-unit-2'],
        tags: [],
        obms: [{ obm: '/api/2.0/obms/574dcd5794ab6e2506fd107a'}],
        type: 'compute',
        relations: [
            {
                "relationType":"enclosedBy",
                "targets":["5994f71bd0e1e80257af9ff7"]
            }
        ]
    };
    var dellNodeObm ={
        id: "DELL574dcd5794ab6e2506fd107a",
        node: "DELLabcd1234abcd1234abcd",
        service: 'dell-wsman-obm-service',
        config: {
            host: '1.2.3.4',
            user: 'myuser',
            password: 'mypass'
       }
    };

    var dellNode = {
        autoDiscover: false,
        id: 'DELLabcd1234abcd1234abcd',
        name: 'dell node',
        identifiers: ['ABCDEFG'],
        tags: [],
        obms: [{ obm: '/api/2.0/obms/DELL574dcd5794ab6e2506fd107a'}],
        type: 'compute',
        relations: [
            {
                relationType: 'enclosedBy',
                targets: [ '4567efgh4567efgh4567efgh' ]
            }
        ]
    };

    // Skip reading the entry from Mongo and return the entry directly
    function redirectGet(entry) {
        if( entry !== 'error.2.0.json') {
            entry = 'redfish-1.0/' + entry;
        }
        return fs.readFileAsync(__dirname + '/../../../../data/views/' + entry, 'utf-8')
            .then(function(contents) {
                return { contents: contents };
            });
    }

    helper.httpServerBefore();

    before(function () {
        view = helper.injector.get('Views');
        redfish = helper.injector.get('Http.Api.Services.Redfish');
        validator = helper.injector.get('Http.Api.Services.Schema');
        waterline = helper.injector.get('Services.Waterline');
        Promise = helper.injector.get('Promise');
        Errors = helper.injector.get('Errors');
        taskProtocol = helper.injector.get('Protocol.Task');
        nodeApi = helper.injector.get('Http.Services.Api.Nodes');
        racadm = helper.injector.get('JobUtils.RacadmTool');
        wsman = helper.injector.get('Http.Services.Wsman');
        configuration = helper.injector.get('Services.Configuration');
        lookup = helper.injector.get('Services.Lookup');
        var nodeFs = helper.injector.get('fs');
        fs = Promise.promisifyAll(nodeFs);
        tv4 = require('tv4');
    });

    beforeEach('set up mocks', function () {
        this.sandbox.stub(view, "get", redirectGet);
        this.sandbox.spy(redfish, 'render');
        this.sandbox.spy(redfish, 'validateSchema');
        this.sandbox.spy(redfish, 'handleError');
        this.sandbox.spy(validator, 'validate');
        this.sandbox.stub(waterline.nodes);
        this.sandbox.stub(waterline.catalogs);
        this.sandbox.stub(waterline.workitems);
        this.sandbox.stub(lookup, 'macAddressToIp');
        this.sandbox.stub(waterline.obms);
        this.sandbox.stub(taskProtocol);
        this.sandbox.stub(nodeApi, "setNodeWorkflowById");
        this.sandbox.stub(nodeApi, "getAllNodes");
        this.sandbox.stub(racadm, "runCommand");
        this.sandbox.stub(wsman, "getLog");
        this.sandbox.spy(tv4, "validate");
        this.sandbox.stub(mktemp, 'createFile');
        this.sandbox.stub(fs, 'writeFile');

        waterline.nodes.getNodeById.resolves();
        waterline.nodes.needByIdentifier.resolves();

        waterline.nodes.needByIdentifier.withArgs(node.id).resolves(Promise.resolve(node));
        waterline.nodes.needByIdentifier.withArgs(dellNode.id).resolves(Promise.resolve(dellNode));

        waterline.nodes.getNodeById.withArgs(node.id).resolves(Promise.resolve(node));
        waterline.nodes.getNodeById.withArgs(dellNode.id).resolves(Promise.resolve(dellNode));

        waterline.catalogs.findLatestCatalogOfSource.rejects(new Errors.NotFoundError());
        nodeApi.setNodeWorkflowById.resolves({instanceId: 'abcdef'});

        waterline.obms.findByNode.resolves(undefined);
        waterline.obms.findByNode.withArgs(node.id, 'ipmi-obm-service', true).resolves(Promise.resolve(nodeObm));
        waterline.obms.findByNode.withArgs(dellNode.id, 'dell-wsman-obm-service', true).resolves(Promise.resolve(dellNodeObm));

        mktemp.createFile.withArgs('/nfs/XXXXXX.xml')
        .resolves(Promise.resolve('/nfs/file.xml'));
        fs.writeFile.withArgs('/nfs/file.xml',xmlData, function() {})
        .resolves(Promise.resolve(undefined));
    });

    helper.httpServerAfter();


    // Lookup table mocks. With and without ip address
    var lookup_ip = '123.1.1.1';

    var catalogData = {
        dmi: {
            chassis : {
                asset_tag: 'test'
            },
            system: {
                Manufacturer: 'test',
                sku_number: 'test',
                product_name: 'test',
                serial_number: 'test',
                uuid: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'
            },
            bios: {
                version : "S2S_3A14         ",
                release_date : "09/18/2014",
                bios_revision : "5.6"
            },
            processor: {
                version: 'test'
            }
        },
        ohai: {
            network: {
                interfaces: {
                    eth0: {
                        addresses: {
                            "2C:60:0C:6F:B4:AF": {
                                family: "lladdr"
                            }
                        }
                    },
                    eth1: {
                        addresses: {
                            "172_31_128_19": {
                                broadcast: "172.31.131.255",
                                family: "inet",
                                netmask: "255.255.252.0",
                                scope: "Global"
                            },
                            "2C:60:0C:6F:B4:B0": {
                                family: "lladdr"
                            },
                            "fe80::2e60:cff:fe6f:b4b0": {
                                family: "inet6",
                                scope: "Link"
                            }
                        },
                        mtu: "1500",
                        state: "up",
                        type: "eth"
                    },
                    lo: {
                        encapsulation: "Loopback",
                        mtu: "65536",
                        state: "down"
                    }
                }
            }
        },
        cpu: {
            real: "1",
            0: {
                vendor_id: 'test'
            }
        },
        Redfish: [

        ],
        kernel: {
            machine: 'x86_64'
        },
        'Memory Device': [
            {
                Size: '16384 MB'
            }
        ],
        'Processor Information' : [
            {
                'Socket Designation': 'test',
                Manufacturer: 'test',
                'Max Speed': '2300 MHz',
                'Core Count': '10',
                'Thread Count': '20',
                Version: 'Intel(R) Xeon(R) CPU E5-2650 v3 @ 2.30GHz',
                ID: 'test',
                'Status': 'Populated, Enabled',
                Family: 'test'
            },
            {
                "Asset Tag": "Not Specified",
                "Characteristics": "None",
                "Current Speed": "Unknown",
                "External Clock": "Unknown",
                Family: "<OUT OF SPEC>",
                ID: "test2",
                "L1 Cache Handle": "Not Provided",
                "L2 Cache Handle": "Not Provided",
                "L3 Cache Handle": "Not Provided",
                Manufacturer: "Not Specified",
                "Max Speed": "Unknown",
                "Part Number": "Not Specified",
                "Serial Number": "Not Specified",
                "Socket Designation": "SOCKET 1",
                "Status": "Unpopulated",
                "Type": "<OUT OF SPEC>",
                "Upgrade": "<OUT OF SPEC>",
                Version: "Not Specified",
                "Voltage": "Unknown"
            }
        ],
        "smart": [
            {
                "Controller": {
                    "controller_PCI_BDF": "0000:03:00.0",
                    "controller_name": "LSI Logic / Symbios Logic MegaRAID SAS-3 3108 [Invader] (rev 02)",
                    "host_ID": "0"
                },
                "SMART": {
                    "Identity": {
                        "Device type": "disk",
                        "Logical block size": "512 bytes",
                        "Product": "MR9361-8i",
                        "Revision": "4.20",
                        "SMART support is": "Unavailable - device lacks SMART capability.",
                        "Serial number": "0036acee028fd5fc1de09df708b00506",
                        "User Capacity": "1,198,597,865,472 bytes [1.19 TB]",
                        "Vendor": "LSI"
                    }
                }
            },
            {
                "Controller": {
                    "controller_PCI_BDF": "0000:03:00.0",
                    "controller_name": "LSI Logic / Symbios Logic MegaRAID SAS-3 3108 [Invader] (rev 02)",
                    "host_ID": "0"
                },
                "SMART": {
                    "Identity": {
                        "Logical block size": "512 bytes",
                        "Physical block size": "4096 bytes",
                        "Product": "HUSMM1640ASS200",
                        "Revision": "A204",
                        "Rotation Rate": "Solid State Device",
                        "Serial number": "0QV6E90A",
                        "Transport protocol": "SAS",
                        "User Capacity": "400,088,457,216 bytes [400 GB]",
                        "Vendor": "HGST"
                    }
                }
            },
            {
                "Controller": {
                    "controller_PCI_BDF": "0000:03:00.0",
                    "controller_name": "LSI Logic / Symbios Logic MegaRAID SAS-3 3108 [Invader] (rev 02)",
                    "host_ID": "0"
                },
                "SMART": {
                    "Identity": {
                        "Logical block size": "512 bytes",
                        "Product": "HUC109090CSS600",
                        "Revision": "A5B0",
                        "Rotation Rate": "10020 rpm",
                        "Serial number": "W8G3MUUX",
                        "Transport protocol": "SAS",
                        "User Capacity": "900,185,481,216 bytes [900 GB]",
                        "Vendor": "HITACHI"
                    }
                }
            }
        ]
    };

    var dellCatalogData =
    {
        bios: {
            "dcimBIOSEnumerationTypeList": [
                {
                    "any": [],
                    "attributeDisplayName": {
                        "otherAttributes": {},
                        "value": "System Memory Testing"
                    },
                    "attributeName": {
                        "otherAttributes": {},
                        "value": "MemTest"
                    },
                    "caption": null,
                    "currentValue": [
                        {
                            "otherAttributes": {},
                            "value": "Disabled"
                        }
                    ],
                    "isReadOnly": {
                        "otherAttributes": {},
                        "value": "false"
                    }
                }
            ]
        },
        "boot": {
            "bootSequenceRetry": {
                "currentValue": "Enabled",
                "possibleValues": [
                    "Enabled",
                    "Disabled"
                ]
            },
            "bootSourcesByBootModes": {
                "bootSourcesByBootMode": [
                    {
                        "bootMode": "BIOS",
                        "bootSources": {
                            "bootSource": [
                                {
                                    "currentSequence": "0",
                                    "enabled": false,
                                    "instanceId": "IPL:BIOS.Setup.1-1#BootSeq#NIC.Integrated.1-1-1#3af7bdf4ca33fa61a730ab808b217b76",
                                    "name": "Integrated NIC 1 Port 1 Partition 1: IBA XE Slot 0100 v2334 BootSeq",
                                    "type": "IPL"
                                },
                                {
                                    "currentSequence": "1",
                                    "enabled": true,
                                    "instanceId": "IPL:BIOS.Setup.1-1#BootSeq#NIC.Integrated.1-3-1#b2401d51f8600b7a76c243bea93fbc17",
                                    "name": "Integrated NIC 1 Port 3 Partition 1: IBA GE Slot 0600 v1562 BootSeq",
                                    "type": "IPL"
                                },
                                {
                                    "currentSequence": "2",
                                    "enabled": true,
                                    "instanceId": "IPL:BIOS.Setup.1-1#BootSeq#HardDisk.List.1-1#c9203080df84781e2ca3d512883dee6f",
                                    "name": "Hard drive C: BootSeq",
                                    "type": "IPL"
                                }
                            ]
                        }
                    }
                ]
            },
            "currentBootMode": "BIOS",
            "hardDrives": {
                "hardDrive": [
                    {
                        "currentSequence": "0",
                        "enabled": true,
                        "instanceId": "BCV:BIOS.Setup.1-1#HddSeq#RAID.Integrated.1-1#64ecb602db2eafbac9e34b9e83f405ae",
                        "name": "Integrated RAID Controller 1: PERC H730P Mini(bus 02 dev 00) HddSeq",
                        "type": "BCV"
                    }
                ]
            },
            "includeBootOrderInProfile": true
        },
        DeviceSummary: {
            id: "1.2.3.4"
        },
        "leds": [],
        "cpus": [
            {
                "cpuFamily": "B3",
                "cpuStatus": "1",
                "currentClockSpeed": "2500",
                "deviceDescription": "CPU 1",
                "fqdd": "CPU.Socket.1",
                "hyperThreadingCapable": "1",
                "hyperThreadingEnabled": "1",
                "id": 0,
                "manufacturer": "Intel",
                "maxClockSpeed": "4000",
                "model": "Intel(R) Xeon(R) CPU E5-2680 v3 @ 2.50GHz",
                "numberOfEnabledCores": "12",
                "numberOfProcessorCores": "12",
                "primaryStatus": "1",
                "turboModeCapable": "1",
                "turboModeEnabled": "1",
                "virtualizationTechnologyCapable": "1",
                "virtualizationTechnologyEnabled": "1",
                "voltage": "1.3"
            }
        ],
        "system": {
            "assetTag": "",
            "boardSerialNumber": "CN7792159B000W",
            "biosReleaseDate": "2015-01-09T00:03:00Z",
            "biosVersionString": "1.2.10",
            "fQDD": "RAID.Integrated.1-1",
            "hostName": "ESXi55.hwimo.lab.emc.com",
            "manufacturer": " ",
            "model": " ",
            "populatedCpuSockets": "2",
            "powerState": "2",
            "serviceTag": "BPM0182",
            "storageRollupStatus": "1",
            "systemGeneration": "13G Monolithic",
            "sysMemTotalSize": 384,
            "uuid": "4c4c4544-0050-4d10-8030-c2c04f313832"
        },
        "storage": {
            "controllers": [
                {
                    "controllerFirmwareVersion": "25.3.0.0016",
                    "deviceCardManufacturer": "DELL",
                    "fQDD": "RAID.Integrated.1-1",
                    "primaryStatus": "1",
                    "productName": "PERC H730P Mini",
                    "possibleSpeed": "1_5_GBS",
                    "sasaddress": "514187704AD4F700"
                }
            ],
            "physicalDisks": [
                {
                    "blockSizeInBytes": "512",
                    "busProtocol": "6",
                    "deviceDescription": "Disk 0 in Backplane 1 of Integrated RAID Controller 1",
                    "fqdd": "Disk.Bay.0:Enclosure.Internal.0-1:RAID.Integrated.1-1",
                    "hotSpareStatus": "0",
                    "manufacturer": "TOSHIBA",
                    "maxCapableSpeed": "4",
                    "mediaType": "1",
                    "model": "PX02SMF040",
                    "operationName": "None",
                    "operationPercentComplete": "0",
                    "ppid": "PH0HKK8C264025AV0JK2A03",
                    "primaryStatus": "1",
                    "revision": "A3AF",
                    "sasaddress": "500003969C8A6E8E",
                    "securityState": "0",
                    "serialNumber": "X5V0A02TT0QB",
                    "sizeInBytes": "399431958528"
                },
                {
                    "blockSizeInBytes": "512",
                    "busProtocol": "6",
                    "deviceDescription": "Disk 1 in Backplane 1 of Integrated RAID Controller 1",
                    "fqdd": "Disk.Bay.1:Enclosure.Internal.0-1:RAID.Integrated.1-1",
                    "hotSpareStatus": "0",
                    "manufacturer": "TOSHIBA",
                    "maxCapableSpeed": "4",
                    "mediaType": "1",
                    "model": "PX02SMF040",
                    "operationName": "None",
                    "operationPercentComplete": "0",
                    "ppid": "PH0HKK8C264025AV0JK2A03",
                    "primaryStatus": "1",
                    "revision": "A3AF",
                    "sasaddress": "500003969C8A6E11",
                    "securityState": "0",
                    "serialNumber": "X5V0A03DT0QB",
                    "sizeInBytes": "399431958528"
                },
                {
                    "blockSizeInBytes": "512",
                    "busProtocol": "6",
                    "deviceDescription": "Disk 2 in Backplane 1 of Integrated RAID Controller 1",
                    "fqdd": "Disk.Bay.2:Enclosure.Internal.0-1:RAID.Integrated.1-1",
                    "hotSpareStatus": "0",
                    "manufacturer": "SEAGATE",
                    "maxCapableSpeed": "4",
                    "mediaType": "0",
                    "model": "ST1200MM0088",
                    "operationName": "None",
                    "operationPercentComplete": "0",
                    "ppid": "PH0HKK8C264025AV0JK2A03",
                    "primaryStatus": "1",
                    "revision": "A3AF",
                    "sasaddress": "500003969C8A6Eff",
                    "securityState": "0",
                    "serialNumber": "S400QAPL",
                    "sizeInBytes": "399431958528"

                }
            ],
            "virtualDisks": [
                {
                    "blockSizeInBytes": "512",
                    "busProtocol": "6",
                    "cacheCade": "0",
                    "deviceDescription": "Virtual Disk 1 on Integrated RAID Controller 1",
                    "diskCachePolicy": "256",
                    "fqdd": "Disk.Virtual.1:RAID.Integrated.1-1",
                    "id": 0,
                    "instanceId": "Disk.Virtual.1:RAID.Integrated.1-1",
                    "lastSystemInventoryTime": "20170726165951.000000+000",
                    "lastUpdateTime": "20170726175943.000000+000",
                    "lockStatus": "0",
                    "mediaType": "1",
                    "name": "Virtual Disk 1",
                    "objectStatus": "0",
                    "operationName": "None",
                    "operationPercentComplete": "0",
                    "pendingOperations": "0",
                    "physicalDiskIds": [
                        "Disk.Bay.0:Enclosure.Internal.0-1:RAID.Integrated.1-1",
                        "Disk.Bay.1:Enclosure.Internal.0-1:RAID.Integrated.1-1",
                        "Disk.Bay.2:Enclosure.Internal.0-1:RAID.Integrated.1-1"
                    ],
                    "primaryStatus": "1",
                    "raidStatus": "2",
                    "raidTypes": "4",
                    "readCachePolicy": "32",
                    "remainingRedundancy": "1",
                    "rollupStatus": "1",
                    "sizeInBytes": "1199638052864",
                    "spanDepth": "1",
                    "spanLength": null,
                    "startingLbaInBlocks": "0",
                    "stripeSize": "128",
                    "t10piStatus": "0",
                    "virtualDiskTargetId": "1",
                    "writeCachePolicy": "2"
                }
            ]
        },
        nics: [
            {
                "autoNegotiation": "2",
                "busNumber": "5",
                "controllerBiosVersion": null,
                "currentMACAddress": "F8:BC:12:0B:0B:40",
                "dataBusWidth": "0002",
                "deviceDescription": "Integrated NIC 1 Port 1 Partition 1",
                "deviceNumber": "0",
                "familyDriverVersion": "16.5.20",
                "familyVersion": "16.5.20",
                "fcoEOffloadMode": "3",
                "fcoEWwnn": null,
                "fqdd": "NIC.Integrated.1-1-1",
                "id": 0,
                "iscsiBootMode": null,
                "iscsiInitiatorGateway": null,
                "iscsiInitiatorIpAddress": null,
                "iscsiInitiatorName": null,
                "iscsiInitiatorPrimaryDns": null,
                "iscsiInitiatorSecondryDns": null,
                "iscsiInitiatorSubnet": null,
                "iscsiMacAddress": null,
                "iscsiOffloadMode": "3",
                "iscsiOffloadSupport": null,
                "legacyBootProtocol": null,
                "linkDuplex": "1",
                "linkSpeed": "3",
                "linkStatus": null,
                "macAddress": null,
                "maxBandwidth": "0",
                "mediaType": "Base T",
                "minBandwidth": "0",
                "nicMode": "3",
                "osDriverState": null,
                "pciDeviceID": "1521",
                "pciSubDeviceID": "1028",
                "permanentFcoMacAddress": "F8:BC:12:0B:0B:40",
                "permanentMacAddress": "F8:BC:12:0B:0B:40",
                "permanentiScsiMacAddress": "",
                "productName": "Intel(R) Gigabit 4P X710/I350 rNDC - F8:BC:12:0B:0B:40",
                "receiveFlowControl": "2",
                "slotLength": "0002",
                "slotType": "0002",
                "teaming": "< NIC # > , < NIC # >",
                "toeSupport": null,
                "transmitFlowControl": "3",
                "vendorName": "Intel Corp",
                "virtWwn": null,
                "virtWwpn": null,
                "virtualIscsiMacAddress": null,
                "virtualMacAddress": null,
                "wwn": null,
                "wwpn": null
            },
            {
                "autoNegotiation": "2",
                "busNumber": "5",
                "controllerBiosVersion": null,
                "currentMACAddress": "F8:BC:12:0B:0B:41",
                "dataBusWidth": "0002",
                "deviceDescription": "Integrated NIC 1 Port 2 Partition 1",
                "deviceNumber": "0",
                "familyDriverVersion": "16.5.20",
                "familyVersion": "16.5.20",
                "fcoEOffloadMode": "3",
                "fcoEWwnn": null,
                "fqdd": "NIC.Integrated.1-2-1",
                "id": 0,
                "iscsiBootMode": null,
                "iscsiInitiatorGateway": null,
                "iscsiInitiatorIpAddress": null,
                "iscsiInitiatorName": null,
                "iscsiInitiatorPrimaryDns": null,
                "iscsiInitiatorSecondryDns": null,
                "iscsiInitiatorSubnet": null,
                "iscsiMacAddress": null,
                "iscsiOffloadMode": "3",
                "iscsiOffloadSupport": null,
                "legacyBootProtocol": null,
                "linkDuplex": "0",
                "linkSpeed": "0",
                "linkStatus": null,
                "macAddress": null,
                "maxBandwidth": "0",
                "mediaType": "Base T",
                "minBandwidth": "0",
                "nicMode": "3",
                "osDriverState": null,
                "pciDeviceID": "1521",
                "pciSubDeviceID": "1028",
                "permanentFcoMacAddress": "F8:BC:12:0B:0B:41",
                "permanentMacAddress": "F8:BC:12:0B:0B:41",
                "permanentiScsiMacAddress": "",
                "productName": "Intel(R) Gigabit 4P X710/I350 rNDC - F8:BC:12:0B:0B:41",
                "receiveFlowControl": "2",
                "slotLength": "0002",
                "slotType": "0002",
                "teaming": "< NIC # > , < NIC # >",
                "toeSupport": null,
                "transmitFlowControl": "3",
                "vendorName": "Intel Corp",
                "virtWwn": null,
                "virtWwpn": null,
                "virtualIscsiMacAddress": null,
                "virtualMacAddress": null,
                "wwn": null,
                "wwpn": null
            }
        ]
    };

    var catalogDataWithBadProcessor = {
        'Processor Information' : [
            {
                "Asset Tag": "Not Specified",
                "Characteristics": "None",
                "Current Speed": "Unknown",
                "External Clock": "Unknown",
                Family: "<OUT OF SPEC>",
                ID: "test2",
                "L1 Cache Handle": "Not Provided",
                "L2 Cache Handle": "Not Provided",
                "L3 Cache Handle": "Not Provided",
                Manufacturer: "Not Specified",
                "Max Speed": "Unknown",
                "Part Number": "Not Specified",
                "Serial Number": "Not Specified",
                "Socket Designation": "SOCKET 1",
                "Status": "Unpopulated",
                "Type": "<OUT OF SPEC>",
                "Upgrade": "<OUT OF SPEC>",
                Version: "Not Specified",
                "Voltage": "Unknown"
            }
          ]
    };

    var redfishCatalog = {
        Redfish: {
            "@odata_context": "/redfish/v1/$metadata#SimpleStorage.SimpleStorage",
            "@odata_id": "/redfish/v1/Systems/System.Embedded.1/Storage/Controllers/AHCI.Embedded.1-1",
            "@odata_type": "#SimpleStorage.v1_0_2.SimpleStorage",
            "Description": "Simple Storage Controller",
            "Devices": [
                {
                    "Manufacturer": "INTEL",
                    "Model": "DSC2BX800G4R",
                    "Name": "Solid State Disk 0:0",
                    "Status": {
                        "Health": null,
                        "HealthRollUp": null,
                        "State": "Enabled"
                    }
                },
                {
                    "Manufacturer": "INTEL",
                    "Model": "DSC2BX800G4R",
                    "Name": "Solid State Disk 1:1",
                    "Status": {
                        "Health": null,
                        "HealthRollUp": null,
                        "State": "Enabled"
                    }
                },
                {
                    "Manufacturer": "INTEL",
                    "Model": "DSC2BX800G4R",
                    "Name": "Solid State Disk 2:2",
                    "Status": {
                        "Health": null,
                        "HealthRollUp": null,
                        "State": "Enabled"
                    }
                }
            ],
            "Devices@odata_count": 3,
            "Id": "AHCI.Embedded.1-1",
            "Name": "C610/X99 series chipset sSATA Controller [AHCI mode]",
            "Status": {
                "Health": null,
                "HealthRollUp": null,
                "State": "Enabled"
            },
            "UEFIDevicePath": "PciRoot(0x0)/Pci(0x11,0x4)"
        }
    };
    var redfishCatalogArray = [
        {
            data: {
                "@odata_context": "/redfish/v1/$metadata#SimpleStorage.SimpleStorage",
                "@odata_id": "/redfish/v1/Systems/System.Embedded.1/Storage/Controllers/AHCI.Embedded.1-1",
                "@odata_type": "#SimpleStorage.v1_0_2.SimpleStorage",
                "Description": "Simple Storage Controller",
                "Devices": [
                    {
                        "Manufacturer": "INTEL",
                        "Model": "DSC2BX800G4R",
                        "Name": "Solid State Disk 0:0",
                        "Status": {
                            "Health": null,
                            "HealthRollUp": null,
                            "State": "Enabled"
                        }
                    },
                    {
                        "Manufacturer": "INTEL",
                        "Model": "DSC2BX800G4R",
                        "Name": "Solid State Disk 1:1",
                        "Status": {
                            "Health": null,
                            "HealthRollUp": null,
                            "State": "Enabled"
                        }
                    },
                    {
                        "Manufacturer": "INTEL",
                        "Model": "DSC2BX800G4R",
                        "Name": "Solid State Disk 2:2",
                        "Status": {
                            "Health": null,
                            "HealthRollUp": null,
                            "State": "Enabled"
                        }
                    }
                ],
                "Devices@odata_count": 3,
                "Id": "AHCI.Embedded.1-1",
                "Name": "C610/X99 series chipset sSATA Controller [AHCI mode]",
                "Status": {
                    "Health": null,
                    "HealthRollUp": null,
                    "State": "Enabled"
                },
                "UEFIDevicePath": "PciRoot(0x0)/Pci(0x11,0x4)"

            }
        }
    ];

    var redfishVolumeCreate = {
        "username": "someuser",
        "password": "somepassword",
        "volume": {
            "Id": "AnId",
            "Name": "volumeToCreate",
            "CapacityBytes": 1234567,
            "VolumeType": "NonRedundant",
            "Links": {
                "Drives@odata.count": 3,
                "Drives": [
                    {
                        "@odata.id": "/redfish/v1/Systems/SomeNodeId/Storage/RAID.Integrated.1-1/Drives/0"
                    },
                    {
                        "@odata.id": "/redfish/v1/Systems/SomeNodeId/Storage/RAID.Integrated.1-1/Drives/1"
                    },
                    {
                        "@odata.id": "/redfish/v1/Systems/SomeNodeId/Storage/RAID.Integrated.1-1/Drives/2"
                    }
                ]
            }
        }
    };

    var smartCatalog = [
        {
            Controller: {
                controller_PCI_BDF: "0000:00:01.1",
                controller_name: "LSI Logic / Symbios Logic MegaRAID SAS-3 3108 [Invader] (rev 02)",
                host_ID: 0
            },
            SMART: {
                Identity: {
                    "Device type": "disk",
                    "Logical block size": "512 bytes",
                    "Product": "MR9361-8i",
                    "Revision": "4.20",
                    "SMART support is": "Unavailable - device lacks SMART capability.",
                    "Serial number": "0036acee028fd5fc1de09df708b00506",
                    "User Capacity": "1,198,597,865,472 bytes [1.19 TB]",
                    "Vendor": "LSI"
                }
            }
        },
        {
            Controller: {
                controller_PCI_BDF: "0000:00:01.1",
                controller_name: "LSI Logic / Symbios Logic MegaRAID SAS-3 3108 [Invader] (rev 02)",
                 host_ID: 0
            },
            SMART: {
                Identity: {
                    "Logical block size": "512 bytes",
                    "Physical block size": "4096 bytes",
                    "Product": "HUSMM1640ASS200",
                    "Revision": "A204",
                    "Rotation Rate": "Solid State Device",
                    "Serial number": "0QV6E90A",
                    "Transport protocol": "SAS",
                    "User Capacity": "400,088,457,216 bytes [400 GB]",
                    "Vendor": "HGST"
                }
            }
        },
        {
            Controller: {
                controller_PCI_BDF: "0000:00:01.1",
                controller_name: "LSI Logic / Symbios Logic MegaRAID SAS-3 3108 [Invader] (rev 02)",
                host_ID: 0
            },
            SMART: {
                Identity: {
                    "Logical block size": "512 bytes",
                    "Product": "HUC109090CSS600",
                    "Revision": "A5B0",
                    "Rotation Rate": "10020 rpm",
                    "Serial number": "W8G3MUUX",
                    "Transport protocol": "SAS",
                    "User Capacity": "900,185,481,216 bytes [900 GB]",
                    "Vendor": "HITACHI"
                }
            }
        },
        {
            Controller: {
                controller_PCI_BDF: "0000:00:1f.2",
                controller_name: "Intel Corporation C610/X99 series chipset 6-Port SATA Controller [AHCI mode] (rev 05)",
                host_ID: 5
            },
            SMART: {
                Identity: {
                    "Device Model": "SATADOM-SH TYPE C 3SE",
                    "Firmware Version": "S130710",
                    "Rotation Rate": "Solid State Device",
                    "SATA Version is": "SATA 3.0, 6.0 Gb/s (current: 6.0 Gb/s)",
                    "Sector Size": "512 bytes logical/physical",
                    "Serial Number": "20151007AA851172502C",
                    "User Capacity": "32,017,047,552 bytes [32.0 GB]"
                }
            }
        }
    ];


    var wsmanSelLog = [
        {
            "creationTimeStamp": "20161206135247.000000-360",
            "elementName": "System Event Log Entry",
            "instanceID": "DCIM:SEL:Entry:23",
            "logInstanceID": "DCIM:SEL:1",
            "logName": "System Event Log",
            "perceivedSeverity": "2",
            "recordData": "Drive 0 is installed in disk drive bay 1.",
            "recordFormat": "string Description",
            "recordID": "23"
        }
    ];

    var wsmanLcLog = [
        {
            "recordId": 1234567,
            "logName": "LifeCycle Log",
            "creationTimeStamp": "20170520141756.000000-300",
            "message": "Successfully logged in using root, from 100.68.124.32 and REDFISH.",
            "severity": "2",
            "category": "Audit",
            "messageId": "USR0030",
            "elementName": "USR0030",
            "instanceId": "DCIM:LifeCycleLog:2173760",
            "logInstanceId": "DCIM:LifeCycleLog",
            "comment": "[set comment here]",
            "agentId": "RACLOG",
            "configResultsAvailable": "false",
            "fqdd": "iDRAC.Embedded.1",
            "messageArguments": "REDFISH",
            "owningEntity": "DCIM",
            "rawEventData": "",
            "sequenceNumber": 2173760
        }
    ];

    var httpEndpoints = [
        {
            "address": "172.31.128.1",
            "authEnabled": false,
            "httpsEnabled": false,
            "port": 9080,
            "proxiesEnabled": true,
            "routers": "southbound-api-router"
        }
    ];

    it('should return a valid system root', function () {
        waterline.nodes.find.resolves([node]);
        return helper.request().get('/redfish/v1/Systems')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body['Members@odata.count']).to.equal(1);
                expect(res.body.Members[0]['@odata.id']).to.equal('/redfish/v1/Systems/' + node.id);
            });
    });

    describe('Get Systems By Indentifier', function () {
        beforeEach('set up mocks', function(){
            this.sandbox.stub(redfish, 'getVendorNameById');
        });
        it('should return a valid system', function() {
            redfish.getVendorNameById.resolves({
                node: node,
                vendor: 'undefined'
            });
            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
                node: node.id,
                source: 'dummysource',
                data: catalogData
            }));

            waterline.workitems.findPollers.resolves([{
                config: { command: 'chassis' }
            }]);

            taskProtocol.requestPollerCache.resolves([{
                chassis: { power: "Unknown", uid: "Reserved"}
            }]);

            return helper.request().get('/redfish/v1/Systems/' + node.id)
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should return a valid system for device with DELL catalogs', function() {
            redfish.getVendorNameById.resolves({
                node: dellNode,
                vendor: 'Dell'
            });
            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
                node: dellNode.id,
                source: 'dummysource',
                data: dellCatalogData
            }));

            waterline.workitems.findPollers.resolves([{
                config: { command: 'chassis' }
            }]);

            taskProtocol.requestPollerCache.resolves([{
                chassis: { power: "Unknown", uid: "Reserved"}
            }]);

            return helper.request().get('/redfish/v1/Systems/' + dellNode.id)
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should return a valid system with sku', function() {
            redfish.getVendorNameById.resolves({
                node: node,
                vendor: 'notDellAndCisco'
            });
            waterline.nodes.needByIdentifier.withArgs(node.id)
            .resolves(Promise.resolve({
                id: node.id,
                name: node.id,
                sku: 'sku-value'
            }));

            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
                node: node.id,
                source: 'dummysource',
                data: catalogData
            }));

            waterline.workitems.findPollers.resolves([{
                config: { command: 'chassis' }
            }]);

            taskProtocol.requestPollerCache.resolves([{
                chassis: { power: "Unknown", uid: "Reserved"}
            }]);

            return helper.request().get('/redfish/v1/Systems/' + node.id)
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

       it('should return a valid  Cisco system', function() {
            redfish.getVendorNameById.resolves({
                node: ucsNode,
                vendor: 'Cisco'
            });

            this.sandbox.stub(nodeApi, "getNodeCatalogSourceById");
            nodeApi.getNodeCatalogSourceById.withArgs(ucsNode.id, 'UCS').resolves({
                node: ucsNode.id,
                source: 'UCS',
                data: {
                    "descr": "",
                    "model": "UCSC-C220-M3S",
                    "serial": "FCH1948V1NG",
                    "vendor": "Cisco Systems Inc",
                    "part_number": "74-9932-02",
                    "uuid": "c3bef8a5-96a8-45d2-9a4d-f4c7da71942e",
                    "num_of_cpus": 1,
                    "total_memory": 256,
                    "oper_power": "off"
                }
            });

            nodeApi.getNodeCatalogSourceById.withArgs(ucsNode.id, "UCS:bios").resolves({
                node: ucsNode.id,
                source: 'UCS:bios',
                data: {
                    "revison":"0"
                }
            });
            nodeApi.getNodeCatalogSourceById.withArgs(ucsNode.id, "UCS:locator-led").resolves({
                node: ucsNode.id,
                source: 'UCS:locator-led',
                data: {
                    "oper_state":"off"
                }
            });
            return helper.request().get('/redfish/v1/Systems/' + ucsNode.id)
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });
        it('should 404 an invalid system', function(){
            redfish.getVendorNameById.resolves({
                node: node,
                vendor: 'Dell'
            });
            return helper.request().get('/redfish/v1/Systems/bad' + node.id)
                .expect('Content-Type', /^application\/json/)
                .expect(404)
                .expect(function(err) {
                    console.log(err.body.error['@Message.ExtendedInfo'][1].Message);
                });
        });
    });

    it('should 404 an invalid identifier for bios query', function() {
        return helper.request().get('/redfish/v1/Systems/bad' + node.id + '/Bios')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 404 a non-Dell identifier for bios query', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id + '/Bios')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid bios block for Dell-based catalog', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'bios').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'bios',
            data: dellCatalogData.bios
        }));
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/Bios')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid identifier for bios settings query', function() {
        return helper.request().get('/redfish/v1/Systems/bad' + node.id + '/Bios/Settings')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 404 a non-Dell identifier for bios settings query', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id + '/Bios/Settings')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid bios settings block for Dell-based catalog', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'bios').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'bios',
            data: dellCatalogData.bios
        }));
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/Bios/Settings')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid system for bios settings patch', function() {
        return helper.request().patch('/redfish/v1/Systems/bad' + node.id + '/Bios/Settings')
            .send({ Name: "bogusname", Id: "someid"})
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 404 non-Dell identifier for bios settings patch', function() {
        return helper.request().patch('/redfish/v1/Systems/' + node.id + '/Bios/Settings')
            .send({ Name: "bogusname", Id: "someid"})
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 202 for a Dell-based bios settings patch', function() {
        // Force a southbound interface through httpEndpoints
        configuration.set('httpEndpoints', httpEndpoints);
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'DeviceSummary').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'DeviceSummary',
            data: dellCatalogData.DeviceSummary
        }));
        return helper.request().patch('/redfish/v1/Systems/' + dellNode.id + '/Bios/Settings')
            .send({ "@odata.context": "string", "@odata.id": "string", "@odata.type": "string", "Actions": { "Oem": {} }, "AttributeRegistry": "string", "Attributes": { "X": "y"}, "Description": "string", "Id": "string", "Name": "string", "Oem": {} })
            .expect('Content-Type', /^application\/json/)
            .expect(202);
    });

    it('should 404 an invalid system for Bios.ChangePassword post', function() {
        return helper.request().post('/redfish/v1/Systems/bad' + node.id + '/Bios.ChangePassword')
            .send({ PasswordName: "bogusname", OldPassword: "somepass", NewPassword: "newpass"})
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 404 an invalid system for Bios.ResetBios', function() {
        return helper.request().post('/redfish/v1/Systems/bad' + node.id + '/Bios.ResetBios')
            .send({"target": {},"title": {}})
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 404 an non-Dell system for Bios.ChangePassword post', function() {
        return helper.request().post('/redfish/v1/Systems/' + node.id + '/Bios.ChangePassword')
            .send({ PasswordName: "bogusname", OldPassword: "somepass", NewPassword: "newpass"})
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });
    it('should 404 non-Dell identifier for Bios.ResetBios', function() {
        return helper.request().post('/redfish/v1/Systems/' + node.id + '/Bios.ResetBios')
            .send({"Bios": {"Oem": {}},"target": {},"title": {}})
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 202 for a Dell-based bios change password SysPassword', function() {
        // Force a southbound interface through httpEndpoints
        configuration.set('httpEndpoints', httpEndpoints);
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'DeviceSummary').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'DeviceSummary',
            data: dellCatalogData.DeviceSummary
        }));
        return helper.request().post('/redfish/v1/Systems/' + dellNode.id + '/Bios.ChangePassword')
            .send({ PasswordName: "SysPassword", OldPassword: "somepass", NewPassword: "newpass"})
            .expect('Content-Type', /^application\/json/)
            .expect(202);
    });

    it('should return a 202 for valid Dell identifier for Bios.ResetBios', function() {
        configuration.set('httpEndpoints', httpEndpoints);
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'DeviceSummary').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'DeviceSummary',
            data: dellCatalogData.DeviceSummary
        }));
        return helper.request().post('/redfish/v1/Systems/' + dellNode.id + '/Bios.ResetBios')
            .send({"target": {},"title": {}})
            .expect('Content-Type', /^application\/json/)
            .expect(202);
    });

    it('should return a 202 for a Dell-based bios change password SetupPassword', function() {
        // Force a southbound interface through httpEndpoints
        configuration.set('httpEndpoints', httpEndpoints);
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'DeviceSummary').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'DeviceSummary',
            data: dellCatalogData.DeviceSummary
        }));
        return helper.request().post('/redfish/v1/Systems/' + dellNode.id + '/Bios.ChangePassword')
            .send({ PasswordName: "SetupPassword", OldPassword: "somepass", NewPassword: "newpass"})
            .expect('Content-Type', /^application\/json/)
            .expect(202);
    });

    it('should 400 an invalid password name for Bios.ChangePassword post', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'DeviceSummary').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'DeviceSummary',
            data: dellCatalogData.DeviceSummary
        }));
        return helper.request().post('/redfish/v1/Systems/' + dellNode.id + '/Bios.ChangePassword')
            .send({ PasswordName: "bogusname", OldPassword: "somepass", NewPassword: "newpass"})
            .expect('Content-Type', /^application\/json/)
            .expect(400);
    });

    /*
        **** EthernetInterface - General
    */

    it('should 404 an invalid identifier for ethernet query', function() {
        return helper.request().get('/redfish/v1/Systems/' + 'bad' + node.id + '/EthernetInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    /*
        **** EthernetInterface - DELL
    */

    it('should 200 a Dell identifier for ethernet query', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'nics').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'nics',
            data: dellCatalogData.nics
        }));
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/EthernetInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return ip given catalog with no ip and ip from lookup (DELL catalogs)', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'nics').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'nics',
            data: dellCatalogData.nics
        }));

        lookup.macAddressToIp.resolves(Promise.resolve(lookup_ip));

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/EthernetInterfaces/' + 'NIC.Integrated.1-1-1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.IPv4Addresses).to.exist;
                expect(res.body.IPv6Addresses).to.not.exist;
                expect(res.body.IPv4Addresses[0].Address).to.equal('123.1.1.1');
            });
    });

    it('should return no ip given catalog with no ip and no ip from lookup (1-1-1) (DELL catalogs)', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'nics').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'nics',
            data: dellCatalogData.nics
        }));

        lookup.macAddressToIp.resolves(Promise.resolve(undefined));

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/EthernetInterfaces/' + 'NIC.Integrated.1-1-1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.IPv4Addresses).to.not.exist;
                expect(res.body.IPv6Addresses).to.not.exist;
            });
    });

    it('should return no ip given catalog with no ip and no ip from lookup (1-2-1) (DELL catalogs)', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'nics').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'nics',
            data: dellCatalogData.nics
        }));

        lookup.macAddressToIp.resolves(Promise.resolve(undefined));

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/EthernetInterfaces/' + 'NIC.Integrated.1-2-1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.SpeedMbps).to.not.exist;
                expect(res.body.FullDuplex).to.not.exist;
                expect(res.body.LinkStatus).to.not.exist;
                expect(res.body.LinkStatus).to.not.equal(null);
                expect(res.body.IPv4Addresses).to.not.exist;
                expect(res.body.IPv6Addresses).to.not.exist;
            });
    });


    it('should 404 a DELL with valid index and invalid ethernet index', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(dellNode.id, 'nics').resolves(Promise.resolve({
            node: dellNode.id,
            source: 'nics',
            data: dellCatalogData.nics
        }));
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/EthernetInterfaces/' + 'BAD' + 'NIC.Integrated.1-1-1')
            .expect('Content-Type', /^application\/json/)
            .expect(404)
            .expect(function() {
                expect(tv4.validate.called).to.be.false;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    /*
        **** EthernetInterface - Non-DELL
    */

    it('should 200 a non-Dell identifier for ethernet query', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'ohai').resolves(Promise.resolve({
            node: node.id,
            source: 'ohai',
            data: catalogData.ohai
        }));
        return helper.request().get('/redfish/v1/Systems/' + node.id + '/EthernetInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid ethernet index block for non-Dell catalog with valid index', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'ohai').resolves(Promise.resolve({
            node: node.id,
            source: 'ohai',
            data: catalogData.ohai
        }));

        lookup.macAddressToIp.resolves(Promise.resolve(lookup_ip));

        return helper.request().get('/redfish/v1/Systems/' + node.id + '/EthernetInterfaces/' + 'eth0')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });


    it('should return ip given catalog with ip an ip from lookup (non-DELL catalogs)', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'ohai').resolves(Promise.resolve({
            node: node.id,
            source: 'ohai',
            data: catalogData.ohai
        }));

        lookup.macAddressToIp.resolves(Promise.resolve(lookup_ip));

        return helper.request().get('/redfish/v1/Systems/' + node.id + '/EthernetInterfaces/' + 'eth1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.IPv4Addresses).to.exist;
                expect(res.body.IPv6Addresses).to.exist;
                expect(res.body.IPv4Addresses[0].Address).to.equal('123.1.1.1');
            });
    });

    it('should return no ip given catalog with ip and no ip from lookup (non-DELL catalogs)', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'ohai').resolves(Promise.resolve({
            node: node.id,
            source: 'ohai',
            data: catalogData.ohai
        }));

        lookup.macAddressToIp.resolves(Promise.resolve(undefined));

        return helper.request().get('/redfish/v1/Systems/' + node.id + '/EthernetInterfaces/' + 'eth1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.IPv6Addresses).to.not.exist;
                expect(res.body.IPv4Addresses).to.not.exist;
            });
    });

    it('should return ip given catalog with no ip and ip from lookup (non-DELL catalogs)', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'ohai').resolves(Promise.resolve({
            node: node.id,
            source: 'ohai',
            data: catalogData.ohai
        }));

        lookup.macAddressToIp.resolves(Promise.resolve(lookup_ip));

        return helper.request().get('/redfish/v1/Systems/' + node.id + '/EthernetInterfaces/' + 'eth0')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.IPv4Addresses).to.exist;
                expect(res.body.IPv6Addresses).to.not.exist;
                expect(res.body.IPv4Addresses[0].Address).to.equal('123.1.1.1');
            });
    });

    it('should return no ip given catalog with no ip and no ip from lookupi (non-DELL catalogs)', function() {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'ohai').resolves(Promise.resolve({
            node: node.id,
            source: 'ohai',
            data: catalogData.ohai
        }));

        lookup.macAddressToIp.resolves(Promise.resolve(undefined));

        return helper.request().get('/redfish/v1/Systems/' + node.id + '/EthernetInterfaces/' + 'eth0')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.IPv4Addresses).to.not.exist;
                expect(res.body.IPv6Addresses).to.not.exist;
            });
    });

    describe('/redfish/v1/Systems/<identifier>/Processors', function() {
        var ucsNode;
        var ucsCatalog;
        var ucsNodeId;

        before('/redfish/v1/Systems/<identifier>/Processors before', function(){
            ucsNodeId = "599337d6ff99ed24305bc58a";
            ucsNode =  {
                "id": ucsNodeId,
                "identifiers": [
                   "10.240.19.70:sys/rack-unit-2"
                ],
                "name": "sys/rack-unit-2"
            };
            ucsCatalog = {
                node: ucsNodeId,
                source: 'UCS',
                data: {num_of_cpus: 2}
            };
        });

        it('should return a valid UCS processor list', function() {
            waterline.catalogs.findLatestCatalogOfSource
                .withArgs(ucsNodeId, 'UCS').resolves(ucsCatalog);
            waterline.nodes.needByIdentifier.withArgs(ucsNodeId).resolves(ucsNode);
            waterline.nodes.getNodeById.withArgs(ucsNodeId).resolves(ucsNode);

            return helper.request().get('/redfish/v1/Systems/' + ucsNodeId + '/Processors')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should return a valid processor list for Dell node', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves({
                node: 'DELLabcd1234abcd1234abcd',
                source: 'dummysource',
                data: dellCatalogData
            });

            return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/Processors')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should return a valid processor list for non-DELL/Ucs nodes', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: catalogData
            });

            return helper.request().get('/redfish/v1/Systems/' + node.id + '/Processors')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should 404 an invalid processor list with invalid nodeId', function() {
            return helper.request().get('/redfish/v1/Systems/bad' + node.id + '/Processors')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });

        it('should 404 an invalid processor list with incorrect catalog', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: catalogDataWithBadProcessor
            });
            return helper.request().get('/redfish/v1/Systems/' + node.id + '/Processors')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });
    });




    describe('/redfish/v1/Systems/<identifier>/Processors/{socketId}', function(){
        var ucsNode;
        var ucsCatalog;
        var ucsProcessorInfo;
        var dellProcessorInfo;
        var redfishProcessorInfo;

        beforeEach('set up mock for Processors', function() {
            this.sandbox.stub(redfish, 'getVendorNameById');
        });

        before('/redfish/v1/Systems/<identifier>/Processors/{socketId} before', function(){
            ucsNode = {
                id : "59a59317f4c25e4d18e6073c",
                autoDiscover : false,
                identifiers : [
                    "10.240.19.70:sys/chassis-1"
                ],
                name : "sys/cisconode",
                relations : [
                    {
                        relationType : "encloses",
                        targets : [ "599444b0303bbe8c07ef004e" ]
                    }
                ],
                tags : [ ],
                type : "enclosure"
            };

            ucsCatalog = {
                node: "59a59317f4c25e4d18e6073c",
                source : "UCS:board",
                data : {
                    "child_action": null,
                    "cmos_voltage": "ok",
                    "cpu_type_description": "ivy-bridge",
                    "children": {
                        "cpu-collection":[
                            {
                                "arch": "Xeon",
                                "cores": "4",
                                "cores_enabled": "4",
                                "dn": "sys/rack-unit-1/board/cpu-2",
                                "id": "2",
                                "model": "Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz",
                                "revision": "0",
                                "rn": "cpu-2",
                                "socket_designation": "CPU2",
                                "speed": "0.002",
                                "status": null,
                                "stepping": "8",
                                "threads": "20",
                                "vendor": "Intel(R) Corporation",
                            },
                            {
                                "arch": "Xeon",
                                "cores": "4",
                                "cores_enabled": "4",
                                "dn": "sys/rack-unit-1/board/cpu-1",
                                "id": "1",
                                "model": "Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz",
                                "revision": "0",
                                "rn": "cpu-1",
                                "sacl": null,
                                "socket_designation": "CPU1",
                                "speed": "0.002",
                                "status": null,
                                "stepping": "8",
                                "threads": "8",
                                "vendor": "Intel(R) Corporation",
                            }
                        ]
                    },
                    "dn": "sys/rack-unit-1/board",
                    "id": "0",
                    "location_dn": "",
                    "model": "UCSC-C220-M3S",
                    "revision": "0",
                    "rn": "board",
                    "serial": "FCH1948V1Q9",
                    "status": null,
                    "vendor": "Cisco Systems Inc",
                }
            };

            ucsProcessorInfo = {
                "@odata.context": "/redfish/v1/$metadata#Processor.Processor",
                "@odata.id": "/redfish/v1/Systems/59a59317f4c25e4d18e6073c/Processors/0",
                "@odata.type": "#Processor.v1_0_0.Processor",
                "Oem": {},
                "Id": "0",
                "Name": "",
                "Socket": "CPU1",
                "ProcessorType": "CPU",
                "ProcessorArchitecture": "x86",
                "InstructionSet": "x86-64",
                "Manufacturer": "Intel(R) Corporation",
                "Model": "Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz",
                "MaxSpeedMHz": 2400,
                "TotalCores": 4,
                "TotalThreads": 8,
                "Status": {},
                "ProcessorId": {
                  "VendorId": "Intel(R) Corporation",
                  "IdentificationRegisters": "",
                  "EffectiveFamily": "Xeon",
                  "EffectiveModel": "Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz",
                  "Step": "8",
                  "MicrocodeInfo": ""
                }
            };

            dellProcessorInfo = {
                '@odata.context': '/redfish/v1/$metadata#Processor.Processor',
                '@odata.id': '/redfish/v1/Systems/DELLabcd1234abcd1234abcd/Processors/0',
                '@odata.type': '#Processor.v1_0_0.Processor',
                Oem: {},
                Id: '0',
                Name: '',
                Socket: 'CPU 1',
                ProcessorType: 'CPU',
                ProcessorArchitecture: 'x86',
                InstructionSet: 'x86-64',
                Manufacturer: 'Intel',
                Model: 'Intel(R) Xeon(R) CPU E5-2680 v3 @ 2.50GHz',
                MaxSpeedMHz: 4000,
                TotalCores: 12,
                TotalThreads: 24,
                Status: {},
                ProcessorId: {
                    VendorId: 'Intel',
                    IdentificationRegisters: '',
                    EffectiveFamily: 'B3',
                    EffectiveModel: 'Intel(R) Xeon(R) CPU E5-2680 v3 @ 2.50GHz',
                    Step: '',
                    MicrocodeInfo: ''
                }
            };

            redfishProcessorInfo = {
                '@odata.context': '/redfish/v1/$metadata#Processor.Processor',
                '@odata.id': '/redfish/v1/Systems/1234abcd1234abcd1234abcd/Processors/0',
                '@odata.type': '#Processor.v1_0_0.Processor',
                Oem: {},
                Id: '0',
                Name: '',
                Socket: 'test',
                ProcessorType: 'CPU',
                ProcessorArchitecture: 'x86',
                InstructionSet: 'x86-64',
                Manufacturer: 'test',
                Model: 'Intel(R) Xeon(R) CPU E5-2650 v3 @ 2.30GHz',
                MaxSpeedMHz: 2300,
                TotalCores: 10,
                TotalThreads: 20,
                Status: {},
                ProcessorId: {
                    VendorId: 'test',
                    IdentificationRegisters: 'test',
                    EffectiveFamily: 'test',
                    EffectiveModel: 'Intel(R) Xeon(R) CPU E5-2650 v3 @ 2.30GHz',
                    Step: '',
                    MicrocodeInfo: ''
                }
            };

        });

        it('should return an error when get system vendor fails', function() {
            redfish.getVendorNameById.rejects('ERROR');
            return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/Processors/0')
                .expect('Content-Type', /^application\/json/)
                .expect(500)
                .expect(function() {
                    expect(redfish.handleError.called).to.be.true;
                });
        });

        it('should return a valid processor for a DELL node', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
                node: 'Dell1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: dellCatalogData
            }));
            redfish.getVendorNameById.resolves({vendor: 'Dell'});

            return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/Processors/0')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function(data) {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                    expect(data.body).to.be.deep.equal(dellProcessorInfo);
                });
        });

        it('should throw an invalid socketId for a DELL node', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: dellCatalogData
            }));
            redfish.getVendorNameById.resolves({vendor: 'Dell'});

            return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/Processors/100')
                .expect('Content-Type', /^application\/json/)
                .expect(404)
                .expect(function(err) {
                    expect(err.body.error['@Message.ExtendedInfo'][1].Message).to.be.equal('invalid socketId');
                });
        });

        it('should return a valid processor for a Cisco node', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve(ucsCatalog));
            waterline.nodes.needByIdentifier.withArgs(ucsNode.id).resolves(Promise.resolve(ucsNode));
            redfish.getVendorNameById.resolves({vendor: 'Cisco'});

            return helper.request().get('/redfish/v1/Systems/' + ucsNode.id + '/Processors/0')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function(data) {
                    expect(data.body).to.be.deep.equal(ucsProcessorInfo);
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should throw an invalid socketId error for Cisco Node', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve(ucsCatalog));
            waterline.nodes.needByIdentifier.withArgs(ucsNode.id).resolves(Promise.resolve(ucsNode));
            redfish.getVendorNameById.resolves({vendor: 'Cisco'});

            return helper.request().get('/redfish/v1/Systems/' + ucsNode.id + '/Processors/100')
                .expect('Content-Type', /^application\/json/)
                .expect(404)
                .expect(function(err) {
                    expect(err.body.error["@Message.ExtendedInfo"][1].Message).to.be.equal('invalid socketId');
                });
        });


        it('should return a valid processor for a non-DELL&non-Cisco node', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: catalogData
            }));
            waterline.nodes.needByIdentifier.withArgs(node.id).resolves(Promise.resolve(node));
            redfish.getVendorNameById.resolves({vendor: 'other'});

            return helper.request().get('/redfish/v1/Systems/' + node.id + '/Processors/0')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function(data) {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                    expect(data.body).to.be.deep.equal(redfishProcessorInfo);
                });
        });

        it('should return an invalid socketId for a non-DELL&non-Cisco node', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: catalogData
            }));
            waterline.nodes.needByIdentifier.withArgs(node.id).resolves(Promise.resolve(node));
            redfish.getVendorNameById.resolves({vendor: 'other'});

            return helper.request().get('/redfish/v1/Systems/' + node.id + '/Processors/100')
                .expect('Content-Type', /^application\/json/)
                .expect(404)
                .expect(function(err) {
                    expect(err.body.error["@Message.ExtendedInfo"][1].Message).to.be.equal('invalid socketId');
                });
        });

        it('should 404 an invalid processor', function() {
            redfish.getVendorNameById.resolves({vendor: 'Dell'});
            return helper.request().get('/redfish/v1/Systems/' + node.id + '/Processors/bad')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });

        it('should 404 an invalid processor', function() {
            redfish.getVendorNameById.resolves({vendor: 'Cisco'});
            return helper.request().get('/redfish/v1/Systems/' + node.id + '/Processors/bad')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });

        it('should 404 an invalid processor', function() {
            redfish.getVendorNameById.resolves({vendor: 'Other'});
            return helper.request().get('/redfish/v1/Systems/' + node.id + '/Processors/bad')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });

    });

    /*
        **** simple storage
    */
    describe('/redfish/v1/Systems/<identifier>/SimpleStorage', function() {
        var ucsNode;
        var ucsCatalog;
        var ucsSimpleStorageInfo;

        beforeEach('set up mock for /redfish/v1/Systems/<identifier>/SimpleStorage', function() {
            this.sandbox.stub(redfish, 'getVendorNameById');
        });

        before('/redfish/v1/Systems/<identifier>/SimpleStorage', function() {
            ucsNode = {
                id: '599337d6ff99ed24305bc58b',
                identifiers: ["10.240.19.70:sys/board"],
            };

            ucsCatalog = {
                "node" : "599337d6ff99ed24305bc58b",
                "source" : "UCS:board",
                "data" : {
                    "vendor" : "Cisco Systems Inc",
                    "children" : {
                        "storage-SAS-collection" : [
                            {
                                "dn" : "sys/chassis-3/blade-7/board/storage-SAS-4",
                                "id" : "4",
                                "pci_addr" : "01:00.0",
                                "pci_slot" : "SAS"
                            },
                            {
                                "dn" : "sys/chassis-3/blade-7/board/storage-SAS-1",
                                "id" : "1",
                                "pci_addr" : "01:00.0",
                                "pci_slot" : "SAS"
                            }
                        ],
                        "storage-PCH-collection" : [
                            {
                                "dn" : "sys/chassis-3/blade-7/board/storage-PCH-1",
                                "id" : "1",
                                "pci_addr" : "01:00.0",
                                "pci_slot" : "PCH"
                            }
                        ],
                        "storage-FlexFlash-collection" : [
                            {
                                "dn" : "sys/chassis-3/blade-7/board/storage-FlexFlash-1",
                                "id" : "1",
                                "pci_addr" : "01:00.0",
                                "pci_slot" : "FlexFlash"
                            }
                        ]
                    }
               }
            };

            ucsSimpleStorageInfo = {
                "@odata.context": "/redfish/v1/$metadata#SimpleStorageCollection.SimpleStorageCollection",
                "@odata.id": "/redfish/v1/Systems/599337d6ff99ed24305bc58b/SimpleStorage",
                "@odata.type": "#SimpleStorageCollection.SimpleStorageCollection",
                "Oem": {},
                "Name": "Simple Storage Collection",
                "Members@odata.count": 4,
                "Members": [
                    {
                      "@odata.id": "/redfish/v1/Systems/599337d6ff99ed24305bc58b/SimpleStorage/SAS_01_00_0_4"
                    },
                    {
                      "@odata.id": "/redfish/v1/Systems/599337d6ff99ed24305bc58b/SimpleStorage/SAS_01_00_0_1"
                    },
                    {
                      "@odata.id": "/redfish/v1/Systems/599337d6ff99ed24305bc58b/SimpleStorage/PCH_01_00_0_1"
                    },
                    {
                      "@odata.id": "/redfish/v1/Systems/599337d6ff99ed24305bc58b/SimpleStorage/FlexFlash_01_00_0_1"
                    }
                ]
            };

        });

        it('should return an error when get system vendor fails', function() {
            redfish.getVendorNameById.rejects('ERROR');
            return helper.request().get('/redfish/v1/Systems/' + ucsNode.id + '/SimpleStorage')
                .expect('Content-Type', /^application\/json/)
                .expect(500)
                .expect(function() {
                    expect(redfish.handleError.called).to.be.true;
                });
        });

        it('should return a valid Cisco simple storage list', function() {
            redfish.getVendorNameById.resolves({vendor: 'Cisco'});
            waterline.nodes.needByIdentifier.withArgs(ucsNode.id).resolves(ucsNode);
            waterline.catalogs.findLatestCatalogOfSource.resolves(ucsCatalog);

            return helper.request().get('/redfish/v1/Systems/' + ucsNode.id + '/SimpleStorage')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function(data) {
                    expect(data.body).to.be.deep.equal(ucsSimpleStorageInfo);
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should return a valid simple storage list for devices with DELL catalogs', function() {
            redfish.getVendorNameById.resolves({vendor: 'Dell'});
            waterline.catalogs.findLatestCatalogOfSource.resolves({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: dellCatalogData
            });

            return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/SimpleStorage')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should return a valid simple storage list for non-Dell & non-Cisco catalogs', function() {
            redfish.getVendorNameById.resolves({vendor: 'Other'});
            waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'smart').resolves({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: smartCatalog
            });

            waterline.catalogs.findLatestCatalogOfSource.resolves({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: catalogData
            });

            return helper.request().get('/redfish/v1/Systems/' + node.id + '/SimpleStorage')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should 404 an invalid simple storage for Dell node', function() {
            redfish.getVendorNameById.resolves({vendor: 'Dell'});
            waterline.nodes.needByIdentifier.rejects(new Errors.NotFoundError('No node found'));

            return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/SimpleStorage')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });

        it('should 404 an invalid simple storage for Cisco node', function() {
            redfish.getVendorNameById.resolves({vendor: 'Cisco'});
            waterline.nodes.needByIdentifier.rejects(new Errors.NotFoundError('No node found'));

            return helper.request().get('/redfish/v1/Systems/' + ucsNode.id + '/SimpleStorage')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });

        it('should 404 an invalid simple storage for non-Dell & non-Cisco node', function() {
            redfish.getVendorNameById.resolves({vendor: 'Other'});
            waterline.nodes.needByIdentifier.rejects(new Errors.NotFoundError('No node found'));

            return helper.request().get('/redfish/v1/Systems/' + node.id + '/SimpleStorage')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });
    });

    describe('Get simple storage device', function(){
        it('should return a valid simple storage device', function() {
            waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'smart')
            .resolves({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: smartCatalog
            });

            waterline.catalogs.findLatestCatalogOfSource.resolves({
                node: '1234abcd1234abcd1234abcd',
                source: 'dummysource',
                data: catalogData
            });

            return helper.request().get('/redfish/v1/Systems/' + node.id +
                                        '/SimpleStorage/0000_00_01_1')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should return a valid simple storage device for devices with DELL catalogs', function() {
            waterline.catalogs.findLatestCatalogOfSource.resolves({
                node: dellNode.id,
                source: 'dummysource',
                data: dellCatalogData
            });

            return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                        '/SimpleStorage/RAID_Integrated_1-1')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });

        it('should 404 an invalid simple storage device', function() {
            return helper.request().get('/redfish/v1/Systems/' + ucsNode.id +
                                        '/SimpleStorage/bad')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });

    });

    describe('Get Cisco valid simple storage device', function(){
        beforeEach('set up mocks', function(){
            this.sandbox.stub(redfish, 'getVendorNameById');
            this.sandbox.stub(nodeApi, "getNodeCatalogSourceById");
        });
        afterEach('restore sanbox', function(){
            this.sandbox.restore();
        });

        it('should return a valid simple storage device with valid contoller', function(){
            redfish.getVendorNameById.resolves({
                node: node,
                vendor: 'Cisco'
            });
            nodeApi.getNodeCatalogSourceById.withArgs(ucsNode.id, 'UCS:board').resolves({
                node: ucsNode.id,
                source: 'UCS:board',
                data:{
                    'children' : {
                        'storage-SAS-collection' : [{
                            'id': '1',
                            'model': 'LSI 6G MegaRAID 9265-8i',
                            'pci_addr': '01:00.0',
                            'children': {
                                'disk-collection': [{
                                    'revision': '0',
                                    'size': '381941995283',
                                    'serial': 'SRVDISK183',
                                    'device_type': '',
                                    'rn': 'disk-2',
                                    'vendor': 'TOSHIBA',
                                    'model': 'PX02SMU040'
                                }]
                            }
                        }]
                    }
                }
            });
            return helper.request().get('/redfish/v1/Systems/'+ucsNode.id+

                                        '/SimpleStorage/SAS_01_00_0_1')
                .expect('Content-Type', /^application\/json/)
                .expect(200)
                .expect(function() {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.render.called).to.be.true;
                });
        });
        it('should return a invalid simple storage device with undefined controller', function(){
            redfish.getVendorNameById.resolves({
                node: node,
                vendor: 'Cisco'
            });
            nodeApi.getNodeCatalogSourceById.withArgs(ucsNode.id, 'UCS:board').resolves({
                node: ucsNode.id,
                source: 'UCS:board',
                data: {
                    children: {}
                }
            });
            return helper.request().get('/redfish/v1/Systems/'+ucsNode.id+
                                        '/SimpleStorage/sas111_01_00_0_1')
                .expect('Content-Type', /^application\/json/)
                .expect(404);
        });
    });

    /*
        **** log services
    */

    it('should return a valid log service', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid sel log service', function() {
        waterline.workitems.findPollers.resolves([{
            config: { command: 'selInformation' }
        }]);

        taskProtocol.requestPollerCache.resolves([{
            selInformation: { '# of Alloc Units': 10, uid: "Reserved"}
        }]);

        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/sel')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid iDRAC sel log service', function() {
        wsman.getLog.withArgs(sinon.match.any, 'SEL').resolves(wsmanSelLog);
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/LogServices/sel')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid sel log service', function() {
        wsman.getLog.withArgs(sinon.match.any, 'SEL').resolves(wsmanSelLog);
        return helper.request().get('/redfish/v1/Systems/bad' + node.id +
                                    '/LogServices/sel')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid sel log service entry collection', function() {
        wsman.getLog.withArgs(sinon.match.any, 'SEL').resolves(wsmanSelLog);
        waterline.workitems.findPollers.resolves([{
            config: { command: 'sel' }
        }]);

        taskProtocol.requestPollerCache.resolves([{
            sel: [{
                logId: 'abcd',
                value: 'Assert',
                sensorType: 'Temperature',
                event: 'thermal event',
                sensorNumber: '#0x01',
                date: '01/01/1970',
                time: '01:01:01'
            }]
        }]);

        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/sel/Entries')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid iDRAC sel log service entry collection', function() {
        wsman.getLog.withArgs(sinon.match.any, 'SEL').resolves(wsmanSelLog);
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/LogServices/sel/Entries')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return an empty sel log service entry collection', function() {
        waterline.workitems.findPollers.resolves([{
            config: { command: 'sel' }
        }]);

        taskProtocol.requestPollerCache.resolves([{
            sel: undefined
        }]);

        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/sel/Entries')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });


    it('should 404 an invalid sel log service entry list', function() {
        return helper.request().get('/redfish/v1/Systems/bad' + node.id +
                                    '/LogServices/sel/Entries')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid sel log service entry with Created keyword', function() {
        waterline.nodes.find.resolves([node]);
        waterline.workitems.findPollers.resolves([{
            config: { command: 'sel' }
        }]);

        taskProtocol.requestPollerCache.resolves([{
            sel: [{
                logId: 'abcd',
                value: 'Assert',
                sensorType: 'Temperature',
                event: 'Thermal Event',
                sensorNumber: '#0x01',
                date: '01/01/1970',
                time: '01:01:01'
            }]
        }]);

        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/sel/Entries/abcd')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.Created).to.exist;
            });
    });

    it('should return a valid sel log service entry without Created keyword',function() {
        waterline.nodes.find.resolves([node]);
        waterline.workitems.findPollers.resolves([{
            config: { command: 'sel' }
        }]);

        taskProtocol.requestPollerCache.resolves([{
            sel: [{
                logId: 'abcd',
                value: 'Assert',
                sensorType: 'Temperature',
                event: 'Thermal Event',
                sensorNumber: '#0x01',
                date: '',
                time: ''
            }]
        }]);

        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/sel/Entries/abcd')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
                expect(res.body.Created).to.not.exist;
            });
    });

    it('should return a valid sel log service entry despite no #', function() {
        waterline.nodes.find.resolves([node]);
        waterline.workitems.findPollers.resolves([{
            config: { command: 'sel' }
        }]);

        taskProtocol.requestPollerCache.resolves([{
            sel: [{
                logId: 'abcd',
                value: 'Assert',
                sensorType: 'Temperature',
                event: 'Thermal Event',
                sensorNumber: '1',
                date: '01/01/1970',
                time: '01:01:01'
            }]
        }]);

        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/sel/Entries/abcd')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid iDrac sel log service entry', function() {
        wsman.getLog.withArgs(dellNode, 'SEL').resolves(wsmanSelLog);
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/LogServices/sel/Entries/23')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid sel log service entry', function() {
        waterline.workitems.findPollers.resolves([{
            config: { command: 'sel' }
        }]);

        taskProtocol.requestPollerCache.resolves([{
            sel: [{
                logId: 'abcd',
                value: 'Assert',
                sensorType: 'Temperature',
                event: 'Thermal Event',
                sensorNumber: '1',
                date: '01/01/1970',
                time: '01:01:01'
            }]
        }]);

        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/sel/Entries/abcdefg')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 404 an invalid iDRAC sel log service entry', function() {
        wsman.getLog.withArgs(dellNode, 'SEL').resolves(wsmanSelLog);

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/LogServices/sel/Entries/abcdefg')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid reset type list', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/Actions/ComputerSystem.Reset')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(view.get.called).to.be.true;
            });
    });

    it('should 404 a reset type list on an invalid node', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    'invalid/Actions/ComputerSystem.Reset')
            .expect(404);
    });

    it('should perform the specified valid reset', function() {
        return helper.request().post('/redfish/v1/Systems/' + node.id +
                                    '/Actions/ComputerSystem.Reset')
            .send({ reset_type: "ForceRestart"})
            .expect('Content-Type', /^application\/json/)
            .expect(202)
            .expect(function(res) {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
            });
    });

    it('should 404 a reset on an invalid node', function() {
        return helper.request().post('/redfish/v1/Systems/' + node.id +
                                    'invalid/Actions/ComputerSystem.Reset')
            .send({ reset_type: "ForceRestart"})
            .expect(404);
    });

    it('should 400 an invalid reset type', function() {
        return helper.request().post('/redfish/v1/Systems/' + node.id +
                                    '/Actions/ComputerSystem.Reset')
            .send({ reset_type: "HalfForceRestart"})
            .expect('Content-Type', /^application\/json/)
            .expect(400);
    });

    it('should return a valid boot image list', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/Actions/RackHD.BootImage')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(view.get.called).to.be.true;
            });
    });

    it('should perform the specified boot image installation with minimum payload', function() {
        var minimumValidBody = {
            repo: "http://172.31.128.1:9080/esxi/5.5",
            version: "6.0",
            rootPassword: "passw0rd"
        };
        return Promise.map(['CentOS', 'CentOS+KVM', 'ESXi', 'RHEL', 'RHEL+KVM'], function(osName) {
            return helper.request().post('/redfish/v1/Systems/' + node.id +
                                        '/Actions/RackHD.BootImage')
                .send( _.merge(minimumValidBody, {osName: osName}) )
                .expect('Content-Type', /^application\/json/)
                .expect(202)
                .expect(function(res) {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.validateSchema.called).to.be.true;
                    expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
                });
        });
    });

    it('should perform the specified boot image installation', function() {
        var minimumValidBody = {
            domain: "rackhd.com",
            hostname: "rackhd",
            osName: "ESXi",
            repo: "http://172.31.128.1:9080/esxi/5.5",
            version: "6.0",
            rootPassword: "passw0rd",
            dnsServers: [ "172.31.128.1" ],
            installDisk: "firstdisk",
            postInstallCommands:['touch a.txt', 'ls /var']
        };
        return Promise.map(['CentOS', 'CentOS+KVM', 'ESXi', 'RHEL', 'RHEL+KVM'], function(osName) {
            return helper.request().post('/redfish/v1/Systems/' + node.id +
                                        '/Actions/RackHD.BootImage')
                .send( _.merge(minimumValidBody, {osName: osName}) )
                .expect('Content-Type', /^application\/json/)
                .expect(202)
                .expect(function(res) {
                    expect(tv4.validate.called).to.be.true;
                    expect(validator.validate.called).to.be.true;
                    expect(redfish.validateSchema.called).to.be.true;
                    expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
                });
        });
    });

    it('should 400 an invalid boot image installation', function() {
        var minimumInvalidBody = {
            osName: "notESXi",
            repo: "http://172.31.128.1:9080/esxi/5.5",
            version: "6.0",
            rootPassword: "passw0rd"
        };

        return helper.request().post('/redfish/v1/Systems/' + node.id +
                                    '/Actions/RackHD.BootImage')
            .send(minimumInvalidBody)
            .expect('Content-Type', /^application\/json/)
            .expect(400);
    });

    it('should return valid SecureBoot status', function() {
        racadm.runCommand.resolves("test=SecureBoot=Disabled");
        return helper.request().get('/redfish/v1/Systems/'+ dellNode.id +'/SecureBoot')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 501 on unsupported URI command', function() {
        racadm.runCommand.rejects("ERROR");
        return helper.request().get('/redfish/v1/Systems/'+ node.id +'/SecureBoot')
            .expect('Content-Type', /^application\/json/)
            .expect(501);
    });

    it('should return 202 after setting Secure Boot', function() {
        racadm.runCommand.resolves( "test=SecureBoot=Disabled" );
        return helper.request().post('/redfish/v1/Systems/'+ node.id +'/SecureBoot')
            .send({"SecureBootEnable": true})
            .expect(202);
    });

    it('should 400 on bad request command', function() {
        return helper.request().post('/redfish/v1/Systems/'+ node.id +'/SecureBoot')
            .send({"zzzSecureBootEnable": true})
            .expect(400);
    });

    it('should 500 on failure', function() {
        racadm.runCommand.rejects("ERROR");
        return helper.request().post('/redfish/v1/Systems/'+ node.id +'/SecureBoot')
            .send({"SecureBootEnable": true})
            .expect(500);
    });

    it('should return a valid lc log service', function() {
        wsman.getLog.withArgs(sinon.match.any, 'LC').resolves(wsmanLcLog);
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/LogServices/lc')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid lc log service', function() {
        wsman.getLog.withArgs(sinon.match.any, 'LC').resolves(wsmanLcLog);
        return helper.request().get('/redfish/v1/Systems/bad' + node.id +
                                    '/LogServices/lc')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid lc log service entry collection', function() {
        wsman.getLog.withArgs(sinon.match.any, 'LC').resolves(wsmanLcLog);
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/LogServices/lc/Entries')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid lc log service entry collection', function() {
        wsman.getLog.withArgs(sinon.match.any, 'LC').resolves(wsmanLcLog);
        return helper.request().get('/redfish/v1/Systems/bad' + dellNode.id +
                                    '/LogServices/lc/Entries')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid lc log service entry', function() {
        wsman.getLog.withArgs(sinon.match.any, 'LC').resolves(wsmanLcLog);
        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/LogServices/lc/Entries/1234567')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid lc log service entry', function() {
        wsman.getLog.withArgs(sinon.match.any, 'LC').resolves(wsmanLcLog);

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/LogServices/lc/Entries/abcdefg')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should 501 on lc service not supported', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/lc')
            .expect('Content-Type', /^application\/json/)
            .expect(501);
    });

    it('should 501 on lc entries not supported', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/lc/Entries')
            .expect('Content-Type', /^application\/json/)
            .expect(501);
    });

    it('should 501 on lc entry not supported', function() {
        return helper.request().get('/redfish/v1/Systems/' + node.id +
                                    '/LogServices/lc/Entries/abcdefg')
            .expect('Content-Type', /^application\/json/)
            .expect(501);
    });

    /*
        **** Storage
    */

    it('should return a valid  storage list', function() {

        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'smart').resolves(Promise.resolve({
            node: '1234abcd1234abcd1234abcd',
            source: 'dmi',
            data: smartCatalog
        }));

        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: '1234abcd1234abcd1234abcd',
            source: 'dmi',
            data: catalogData
        }));

        return helper.request().get('/redfish/v1/Systems/' + node.id + '/Storage')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });


    it('should return a valid storage list for device with DELL catalogs', function() {

        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id + '/Storage')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });


    it('should return a valid  Redfish storage list', function() {
        waterline.catalogs.find.resolves(Promise.resolve(redfishCatalogArray));

        return helper.request().get('/redfish/v1/Systems/' + node.id + '/Storage')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid storage', function() {
        return helper.request().get('/redfish/v1/Systems/bad' + node.id + '/Storage')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid storage device', function () {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'smart')
            .resolves(Promise.resolve({
                node: '1234abcd1234abcd1234abcd',
                source: 'dmi',
                data: smartCatalog
            }));

        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: '1234abcd1234abcd1234abcd',
            source: 'dmi',
            data: catalogData
        }));

        return helper.request().get('/redfish/v1/Systems/' + node.id +
            '/Storage/0000_00_01_1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function () {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid storage device with DELL catalogs', function () {

        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
            '/Storage/RAID_Integrated_1-1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function () {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid Redfish storage device', function () {
        waterline.catalogs.find.resolves(Promise.resolve(redfishCatalogArray));


        return helper.request().get('/redfish/v1/Systems/' + node.id +
            '/Storage/AHCI.Embedded.1-1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function () {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid storage device', function () {
        waterline.catalogs.find.resolves([]);
        return helper.request().get('/redfish/v1/Systems/' + node.id +
            '/Storage/bad')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

   it('should return a valid storage drive with DELL catalogs', function () {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
            '/Storage/RAID_Integrated_1-1/Drives/1')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function () {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });


   it('should return a valid storage drive with non-DELL catalogs', function () {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'smart').resolves(Promise.resolve({
            node: node.id,
            source: 'dummysource',
            data: smartCatalog
        }));

        return helper.request().get('/redfish/v1/Systems/' + node.id +
            '/Storage/0000_00_01_1/Drives/W8G3MUUX')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function () {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });


   it('should return a valid storage drive with non-DELL catalogs (SATADOM)', function () {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'smart').resolves(Promise.resolve({
            node: node.id,
            source: 'dummysource',
            data: smartCatalog
        }));

        return helper.request().get('/redfish/v1/Systems/' + node.id +
            '/Storage/0000_00_1f_2/Drives/20151007AA851172502C')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function () {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid volume list for devices with DELL catalogs', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

   it('should 404 requests for volumes from devices with non-DELL (wsman) catalogs', function () {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'smart').resolves(Promise.resolve({
            node: node.id,
            source: 'dummysource',
            data: smartCatalog
        }));

        return helper.request().get('/redfish/v1/Systems/' + node.id +
            '/Storage/0000_00_01_1/Volumes')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

   it('should 404 requests for specific volumes from devices with non-DELL (wsman) catalogs', function () {
        waterline.catalogs.findLatestCatalogOfSource.withArgs(node.id, 'smart').resolves(Promise.resolve({
            node: node.id,
            source: 'dummysource',
            data: smartCatalog
        }));

        return helper.request().get('/redfish/v1/Systems/' + node.id +
            '/Storage/0000_00_01_1/Volumes/0036acee028fd5fc1de09df708b00506')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });




    it('should return a valid volume for devices with DELL catalogs', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        return helper.request().get('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes/0')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid remove volume for devices with DELL catalogs', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        return helper.request().delete('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes/0')
            .send({ username: "bogusname", password: "somepassword"})
            .expect('Content-Type', /^application\/json/)
            .expect(202)
            .expect(function(res) {
                expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
            });
    });

    it('should return a valid create volume for devices with DELL catalogs (raid type NonRedundant (default))', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        return helper.request().post('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes')
            .send(redfishVolumeCreate)
            .expect('Content-Type', /^application\/json/)
            .expect(202)
            .expect(function(res) {
                expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
            });
    });

    it('should return a valid create volume for devices with DELL catalogs (raid type Mirrored)', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        var newCat = redfishVolumeCreate;
        newCat.volume.VolumeType = "Mirrored";

        return helper.request().post('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes')
            .send(newCat)
            .expect('Content-Type', /^application\/json/)
            .expect(202)
            .expect(function(res) {
                expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
            });
    });

    it('should return a valid create volume for devices with DELL catalogs (raid type StripedWithParity)', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        var newCat = redfishVolumeCreate;
        newCat.volume.VolumeType = "StripedWithParity";

        return helper.request().post('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes')
            .send(newCat)
            .expect('Content-Type', /^application\/json/)
            .expect(202)
            .expect(function(res) {
                expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
            });
    });

    it('should return a valid create volume for devices with DELL catalogs (raid type SpannedMirrors)', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        var newCat = redfishVolumeCreate;
        newCat.volume.VolumeType = "SpannedMirrors";

        return helper.request().post('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes')
            .send(newCat)
            .expect('Content-Type', /^application\/json/)
            .expect(202)
            .expect(function(res) {
                expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
            });
    });

    it('should return a valid create volume for devices with DELL catalogs (raid type SpannedStripesWithParity)', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        var newCat = redfishVolumeCreate;
        newCat.volume.VolumeType = "SpannedStripesWithParity";

        return helper.request().post('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes')
            .send(newCat)
            .expect('Content-Type', /^application\/json/)
            .expect(202)
            .expect(function(res) {
                expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
            });
    });

    it('should return a 400 for an invalid create volume for devices with DELL catalogs (raid type invalid)', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        var newCat = redfishVolumeCreate;
        newCat.volume.VolumeType = "invalid";

        return helper.request().post('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Volumes')
            .send(newCat)
            .expect('Content-Type', /^application\/json/)
            .expect(400);
    });

    it('should return a valid add hot spare for devices with DELL catalogs', function() {
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: dellNode.id,
            source: 'dummysource',
            data: dellCatalogData
        }));

        return helper.request().post('/redfish/v1/Systems/' + dellNode.id +
                                    '/Storage/RAID_Integrated_1-1/Drives/0')
            .send({
                "username": "someuser",
                "password": "somepassword",
                "hotspareType": "dhs",
                "volumeId": "0"
            })
            .expect('Content-Type', /^application\/json/)
            .expect(202)
            .expect(function(res) {
                expect(res.body['@odata.id']).to.equal('/redfish/v1/TaskService/Tasks/abcdef');
            });
    });

});
