// Copyright 2016, EMC, Inc.

'use strict';

var injector = require('../../../index.js').injector;
var redfish = injector.get('Http.Api.Services.Redfish');
var waterline = injector.get('Services.Waterline');
var taskProtocol = injector.get('Protocol.Task');
var Promise = injector.get('Promise');
var _ = injector.get('_');
var nodeApi = injector.get('Http.Services.Api.Nodes');
var controller = injector.get('Http.Services.Swagger').controller;
var Errors = injector.get('Errors');
var moment = require('moment');
var racadm = injector.get('JobUtils.RacadmTool');
var wsman = injector.get('Http.Services.Wsman');
var configuration = injector.get('Services.Configuration');
var mktemp = require('mktemp');
var lookup = injector.get('Services.Lookup');
var fs = require('fs');

var dataFactory = function(identifier, dataName) {
    switch(dataName)  {
        case 'ohai':
        case 'dmi':
        case 'smart':
        case 'hardware':
        case 'boot':
        case 'bios':
        case 'nics':
        case 'DeviceSummary':
        case 'UCS':
        case 'UCS:locator-led':
        case 'UCS:bios':
        case 'UCS:board':
            return nodeApi.getNodeCatalogSourceById(identifier, dataName);
        case 'catData':
            return Promise.all([nodeApi.getNodeCatalogSourceById(identifier,'ohai'), nodeApi.getNodeCatalogSourceById(identifier,'dmi')])
                .spread(function(ohai, dmi) {
                    var catData = _.merge(ohai.data, dmi.data);
                    return catData;
                });
        case 'chassis':
            return nodeApi.getNodeById(identifier)
            .then(function(node) {
                return _.filter(node.relations, function(relation) {
                    return relation.relationType === 'enclosedBy';
                }).map(function(relation) {
                    return relation.targets[0];
                });
            });
        case 'Redfish':
            return waterline.catalogs.find({ "node": identifier, "source": dataName });
        case 'chassisData':
            return nodeApi.getPollersByNodeId(identifier)
            .filter(function(poller) {
                return poller.config.command === 'chassis';
            }).spread(function(poller) {
                return taskProtocol.requestPollerCache(poller.id, { latestOnly: true });
            }).then(function(data) {
                var chassisData = data[0].chassis;
                chassisData.power = (chassisData.power) ? 'On' : 'Off';
                var uidStatus = ['Off', 'Temporary On', 'On',  'Reserved'];
                var validEnum = ['Off', 'Blinking',     'Lit', 'Unknown'];
                chassisData.uid = validEnum[_.indexOf(uidStatus, chassisData.uid)];
                return chassisData;
            }).catch(function() {
                return { power: "Unknown", uid: "Unknown"};
            });

        case 'selInfoData':
            return nodeApi.getPollersByNodeId(identifier)
            .filter(function(poller) {
                return poller.config.command === 'selInformation';
            }).spread(function(poller) {
                return taskProtocol.requestPollerCache(poller.id, { latestOnly: true });
            }).then(function(data) {
                return data[0].selInformation;
            });

        case 'selData':
            return nodeApi.getPollersByNodeId(identifier)
            .filter(function(poller) {
                return poller.config.command === 'sel';
            }).spread(function(poller) {
                return taskProtocol.requestPollerCache(poller.id, { latestOnly: true });
            }).then(function(data) {
                return data[0].sel;
            });

    }
};

//DCIM_View mappings to redfish equivalents
var autoNeg = {
    "2": true, "3": false };

var fullDuplex = {
    "1": true, "2": false };

var linkSpeed = {
    "1": 10, "2": 100, "3": 1000, "4": 2500, "5": 10000,
    "6": 20000, "7": 40000, "8": 100000, "9": 25000, "10":50000 };

var selTranslator = function(selArray, identifier) {
    var dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
    var timeRegex = /(\d{1,2}):(\d{1,2}):(\d{1,2})/;
    var ipmiEventTypeMap = {
        'Asserted': 'Assert',
        'Deasserted': 'Deassert',
        'Lower Non-critical going low': 'Lower Non-critical - going low',
        'Lower Non-critical going high': 'Lower Non-critical - going high',
        'Lower Critical going low': 'Lower Critical - going low',
        'Lower Critical going high': 'Lower Critical - going high',
        'Lower Non-recoverable going low': 'Lower Non-recoverable - going low',
        'Lower Non-recoverable going high': 'Lower Non-recoverable - going high',
        'Upper Non-critical going low': 'Upper Non-critical - going low',
        'Upper Non-critical going high': 'Upper Non-critical - going high',
        'Upper Critical going low': 'Upper Critical - going low',
        'Upper Critical going high': 'Upper Critical - going high',
        'Upper Non-recoverable going low': 'Upper Non-recoverable - going low',
        'Upper Non-recoverable going high': 'Upper Non-recoverable - going high',
        'Predictive Failure Deasserted': 'Predictive Failure deasserted',
        'Predictive Failure Asserted': 'Predictive Failure asserted',
        'Transition to Non-critical from OK': 'Transition to Non-Critical from OK',
        'Device Absent': 'Device Removed / Device Absent',
        'Device Present': 'Device Inserted / Device Present',
        'Non-Redundant: Sufficient from Redundant': 'Non-redundant:Sufficient Resources from Redundant',
        'Non-Redundant: Sufficient from Insufficient': 'Non-redundant:Sufficient Resources from Insufficient Resources',
        'Non-Redundant: Insufficient Resources': 'Non-redundant:Insufficient Resources',
        'Redundancy Degraded from Fully Redundant': 'Redundancy Degraded from Fully Redundant',
        'Redundancy Degraded from Non-Redundant': 'Redundancy Degraded from Fully Redundant'
    };
    var ipmiSensorTypeMap = {
        'Temperature': 'Temperature',
        'Voltage': 'Voltage',
        'Current': 'Current',
        'Fan': 'Fan',
        'Physical Security': 'Physical Chassis Security',
        'Platform Security': 'Platform Security Violation Attempt',
        'Processor': 'Processor',
        'Power Supply': 'Power Supply / Converter',
        'Power Unit': 'PowerUnit',
        'Cooling Device': 'CoolingDevice',
        'Memory': 'Memory',
        'Drive Slot': 'Drive Slot/Bay',
        'System Firmware Progress': 'System Firmware Progress',
        'Event Logging Disabled': 'Event Logging Disabled',
        'Watchdog 1': 'Watchdog',
        'System Event': 'System Event',
        'Critical Interrupt': 'Critical Interrupt',
        'Button': 'Button/Switch',
        'Module/Board': 'Module/Board',
        'Microcontroller/Coprocessor': 'Microcontroller/Coprocessor',
        'Add-in Card': 'Add-in Card',
        'Chassis': 'Chassis',
        'Chip Set': 'ChipSet',
        'Other FRU': 'Other FRU',
        'Cable/Interconnect': 'Cable/Interconnect',
        'Terminator': 'Terminator',
        'System Boot Initiated': 'SystemBoot/Restart',
        'Boot Error': 'Boot Error',
        'OS Boot': 'BaseOSBoot/InstallationStatus',
        'OS Stop/Shutdown': 'OS Stop/Shutdown',
        'Slot/Connector': 'Slot/Connector',
        'System ACPI Power State': 'System ACPI PowerState',
        'Watchdog 2': 'Watchdog',
        'Platform Alert': 'Platform Alert',
        'Entity Presence': 'Entity Presence',
        'Monitor ASIC/IC': 'Monitor ASIC/IC',
        'LAN': 'LAN',
        'Management Subsystem Health': 'Management Subsystem Health',
        'Battery': 'Battery',
        'Version Change': 'Version Change',
        'FRU State': 'FRUState'
    };
    var selTranslatorOrigin = function(sensorType, identifier) {
        switch(sensorType) {
        case 'Drive Slot':
            return '/redfish/v1/Systems/' + identifier + '/SimpleStorage';
        case 'Power Unit':
            return dataFactory(identifier, 'chassis')
                .then(function(chassis) {
                    return '/redfish/v1/Chassis/' + chassis + '/Power';
                });
        case 'Power Supply':
            return dataFactory(identifier, 'chassis')
                .then(function(chassis) {
                    return '/redfish/v1/Chassis/' + chassis + '/Power';
                });
        case 'Fan':
            return dataFactory(identifier, 'chassis')
                .then(function(chassis) {
                    return '/redfish/v1/Chassis/' + chassis + '/Thermal';
                });
        case 'Temperature':
            return dataFactory(identifier, 'chassis')
                .then(function(chassis) {
                    return '/redfish/v1/Chassis/' + chassis + '/Thermal';
                });
        }
        return null;
    };

    return Promise.map(selArray, function(entry) {
        // if date is an empty string then so is time
        var dates = entry.date !== "" ? dateRegex.exec(entry.date) : "";
        var times = entry.date !== "" ? timeRegex.exec(entry.time) : "";
        if(entry.sensorNumber.indexOf('#') !== 0) {
            entry.sensorNumber = '#'+entry.sensorNumber;
        }
        return Promise.props({
            logId: entry.logId,
            // Month is zero indexed by moment so we must decrement
            timestamp: dates !== "" ? moment.utc([dates[3], dates[1] - 1, dates[2], times[1], times[2], times[3]]).format() : "",
            sensorType: _.get(ipmiSensorTypeMap, entry.sensorType, 'Other Units-based Sensor'),
            value: _.get(ipmiEventTypeMap, entry.value, entry.value),
            event: entry.event,
            sensorNumber: parseInt(entry.sensorNumber.substr(1)),
            origin: selTranslatorOrigin(entry.sensorType, identifier)
        });
    });
};

var getObmSettings = function(nodeId){
    return waterline.obms.findByNode(nodeId, 'ipmi-obm-service', true)
        .then(function (obm) {
            if (!obm) {
               return waterline.obms.findByNode(nodeId, 'dell-wsman-obm-service', true);
            }
            return obm;
        })
        .catch(function(err) {
            return (err);
        });
};

/**
 * Generate a list of systems managed by RackHD
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listSystems = controller(function(req, res) {
    var options = redfish.makeOptions(req, res);
    return waterline.nodes.find({type: 'compute'}).then(function(nodes) {
        options.nodes = nodes;
        return redfish.render('redfish.1.0.0.computersystemcollection.json',
                            'ComputerSystemCollection.json#/definitions/ComputerSystemCollection',
                            options);
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Generate information about a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getSystem = controller(function(req, res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);
    options.systemType = 'Physical';

    return redfish.getVendorNameById(identifier)
    .then(function(result){
        var node = result.node;
        if(result.vendor === 'Dell'){
            return Promise.props({
                hardware: dataFactory(identifier, 'hardware'),
                boot: dataFactory(identifier, 'boot'),
                chassis: dataFactory(identifier, 'chassis'),
                chassisData: dataFactory(identifier, 'chassisData'),
                secureBoot: true,
                obm: [node.id, 'RackHD']
            }).then(function(data) {
                return redfish.render('redfish.2016.3.computersystem.1.3.0.json',
                                'ComputerSystem.v1_3_0.json#/definitions/ComputerSystem',
                                _.merge(options, data));
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else if(result.vendor === 'Cisco'){
            return Promise.props({
                hardware: dataFactory(identifier,'UCS'),
                bios: dataFactory(identifier,'UCS:bios'),
                led: dataFactory(identifier,'UCS:locator-led'),
                skuInfo: Promise.try(function(){
                            return node.sku === undefined ? "": node.sku;
                        }),
                chassis: Promise.map(node.relations,function(val){
                            if(val.relationType === 'enclosedBy'){
                                return val.targets;
                            }
                        }),
                obm: [node.id, 'RackHD']
            }).then(function(data){
                return redfish.render('ucs.1.0.0.computersystem.1.3.0.json',
                                'ComputerSystem.v1_3_0.json#/definitions/ComputerSystem',
                                _.merge(options, data));
            }).catch(function(error){
                return redfish.handleError(error, res);
            });
	}else {
            return Promise.props({
                catData: dataFactory(identifier, 'catData'),
                chassis: dataFactory(identifier, 'chassis'),
                chassisData: dataFactory(identifier, 'chassisData'),
                secureBoot: false,
                obm: [node.id, 'RackHD']
            }).then(function(data) {
                return redfish.render('redfish.1.0.0.computersystem.1.1.0.json',
                                'ComputerSystem.v1_3_0.json#/definitions/ComputerSystem',
                                _.merge(options, data));
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        }
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});


/**
 * Generate information about the bios of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listSystemBios = controller(function(req, res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return dataFactory(identifier, 'bios').then(function(bios) {
                options.bios = bios;
                bios.attributes = [];
                var key;
                // create a single bios attribute list (not organized by type)
                for(key in bios.data) {
                    if (bios.data.hasOwnProperty(key)) {
                        bios.attributes = bios.attributes.concat(bios.data[key]);
                    }
                }
                // normalize the currentValue field (some need value fields)
                for(key in bios.attributes) {
                    if (bios.attributes[key].currentValue[0] === null) {
                        bios.attributes[key].currentValue[0] = {"value": null};
                    }
                }
                return options;
            });
        } else {
            throw new Errors.NotFoundError('No BIOS found for node ' + identifier);
        }
    }).then(function(options) {
        return redfish.render('redfish.1.0.0.bios.1.0.0.json',
            'Bios.v1_0_1.json#/definitions/Bios',
            options);
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Generate information about the bios settings data of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listSystemBiosSettings = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return dataFactory(identifier, 'bios').then(function(bios) {
                options.bios = bios;
                bios.attributes = [];
                var key;
                // create a single bios attribute list (not organized by type)
                for(key in bios.data) {
                    if (bios.data.hasOwnProperty(key)) {
                        bios.attributes = bios.attributes.concat(bios.data[key]);
                    }
                }
                for (key = bios.attributes.length - 1; key >= 0; key -= 1) {
                    // remove entries that are readOnly
                    if (bios.attributes[key].isReadOnly.value === "true") {
                        bios.attributes.splice(key, 1);
                        continue;
                    }
                    // normalize the currentValue field (some need value fields)
                    if (bios.attributes[key].currentValue[0] === null) {
                        bios.attributes[key].currentValue[0] = {"value": null};
                    }
                }
                return options;
            });
        } else {
            /* TODO: Not implemented? */
               throw new Errors.NotFoundError(
                    'No BIOS found for node ' + identifier
            );
        }
    }).then(function(options) {
        return redfish.render('redfish.1.0.0.bios.1.0.0.settings.json',
                              'Bios.v1_0_1.json#/definitions/Bios',
                              options);
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Patch information about the bios settings data of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var patchSystemBiosSettings = controller({success: 202}, function(req, res)  {

    var identifier = req.swagger.params.identifier.value;
    redfish.makeOptions(req, res, identifier);
    var payload = req.swagger.params.payload.value;

    var southboundApiRouter = _.filter(configuration.get('httpEndpoints', []),
                                       _.matches({routers:'southbound-api-router'}))[0];

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            var results = { name: "Graph.Dell.Wsman.UpdateSystemComponents", options: {} };

            return dataFactory(identifier, 'DeviceSummary').then(function(summary) {

                results.options = {
                    defaults: {
                        serverIP: summary.data.id,
                        fileName: "",
                        shareType: 0,
                        shareAddress: southboundApiRouter.address,
                        shareName: "/nfs",
                        shutdownType: 0,
                        serverUsername: "",
                        serverPassword: "",
                        serverComponents: [{fqdd: "BIOS.Setup.1-1", attributes: []}]
                    }
                };

                for (var key in payload.Attributes) {
                    if (payload.Attributes.hasOwnProperty(key)) {
                        results.options.defaults.serverComponents[0].attributes.push(
                            {name: key, value: payload.Attributes[key]});
                    }
                }
                return results;
            });
        } else {
            /* TODO: Not implemented? */
             throw new Errors.NotFoundError(
                'Update Bios is not implemented for node ' + identifier
            );
        }
    }).then(function(results) {
        return nodeApi.setNodeWorkflowById(results, identifier);
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Change Bios password of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var changeSystemBiosPassword = controller({success: 202}, function(req, res)  {

    var identifier = req.swagger.params.identifier.value;
    redfish.makeOptions(req, res, identifier);
    var payload = req.swagger.params.payload.value;

    var southboundApiRouter = _.filter(configuration.get('httpEndpoints', []),
                                       _.matches({routers:'southbound-api-router'}))[0];
    var xmlData = `<SystemConfiguration Model=" " ServiceTag=" " TimeStamp=" ">
<Component FQDD="BIOS.Setup.1-1">
    <Attribute Name="OldSetupPassword">xxxx</Attribute>
    <Attribute Name="NewSetupPassword">xxxx</Attribute>
    <Attribute Name="PasswordStatus">Unlocked</Attribute>
</Component>

</SystemConfiguration>`;

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){

            var results = { name: "Graph.Dell.Wsman.UpdateSystemComponents", options: {} };
            return mktemp
                .createFile('/nfs/XXXXXX.xml')
                .then(function(path) {
                    fs.writeFile(path, xmlData,function() {});
                    return dataFactory(identifier, 'DeviceSummary').then(function(summary) {

                        results.options = {
                            defaults: {
                                serverIP: summary.data.id,
                                fileName: path.split('/')[2],
                                shareType: 0,
                                shareAddress: southboundApiRouter.address,
                                shareName: "/nfs",
                                shutdownType: 0,
                                serverUsername: "",
                                serverPassword: "",
                                serverComponents: [{fqdd: "BIOS.Setup.1-1", attributes: []}],
                                cleanup: true
                            }
                        };

                        if (payload.PasswordName === "SysPassword") {
                            results.options.defaults.serverComponents[0].attributes.push(
                                    {name: 'PasswordStatus', value: 'Unlocked'});
                            results.options.defaults.serverComponents[0].attributes.push(
                                    {name: 'OldSysPassword', value: payload.OldPassword});
                            results.options.defaults.serverComponents[0].attributes.push(
                                    {name: 'NewSysPassword', value: payload.NewPassword});
                        }
                        else if (payload.PasswordName ==="SetupPassword") {
                            results.options.defaults.serverComponents[0].attributes.push(
                                    {name: 'OldSetupPassword', value: payload.OldPassword});
                            results.options.defaults.serverComponents[0].attributes.push(
                                    {name: 'NewSetupPassword', value: payload.NewPassword});
                        }
                        else {
                            throw new Errors.BadRequestError('Invalid PasswordName: ' + payload.PasswordName);
                        }
                        return results;
                    });
                });
        } else {
            /* TODO: Not implemented? */
             throw new Errors.NotFoundError(
                'Update Bios is not implemented for node ' + identifier
            );
        }
    }).then(function(results) {
        return nodeApi.setNodeWorkflowById(results, identifier);
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Reset bios settings of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var resetSystemBios = controller({success: 202}, function(req, res)  {
    var identifier = req.swagger.params.identifier.value;

    redfish.makeOptions(req, res, identifier);
    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            var results = { name: "Graph.Dell.Racadm.ResetComponents", options: {} };
            return dataFactory(identifier, 'DeviceSummary').then(function(summary) {
                results.options = {
                    defaults: {
                        components: ["bios"],
                        serverIP: summary.data.id
                    }
                };
                return results;
            });
        } else {
            /* TODO: Not implemented? */
             throw new Errors.NotFoundError(
                'Reset Bios is not implemented for node ' + identifier
            );
        }
    }).then(function(results) {
        return nodeApi.setNodeWorkflowById(results, identifier);
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Generate information about the processors of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listSystemProcessors = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return redfish.getVendorNameById(identifier)
    .then(function(result){
        if(result.vendor === 'Dell'){
            return dataFactory(identifier, 'hardware')
            .then(function(hardware) {
                options.hardware = hardware;
            })
            .then(function(){
                return redfish.render(
                    'wsman.1.0.0.processorcollection.json',
                    'ProcessorCollection.json#/definitions/ProcessorCollection',
                    options
                );
            });
        } else if(result.vendor === 'Cisco'){
            return dataFactory(identifier, 'UCS')
            .then(function(data) {
                options.processors = data;
            })
            .then(function(){
                return redfish.render(
                    'ucs.1.0.0.processorcollection.json',
                    'ProcessorCollection.json#/definitions/ProcessorCollection',
                    options
                );
            });
        } else {
            return dataFactory(identifier, 'dmi').then(function(dmi) {
                options.dmi = dmi;
                options.dmi.data['Processor Information'].forEach(function(element,index){
                    if(element.Status.indexOf('Unpopulated') !== -1){
                        options.dmi.data['Processor Information'].splice(index,1);
                    }
                });
                if(options.dmi.data['Processor Information'].length === 0){
                    throw new Errors.NotFoundError('no valid processor found');
                }
                return redfish.render('redfish.1.0.0.processorcollection.json',
                                'ProcessorCollection.json#/definitions/ProcessorCollection',
                                options);
            });
        }
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Generate specific information about the processors of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getSystemProcessor = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return redfish.getVendorNameById(identifier)
    .then(function(result) {
        if(result.vendor === 'Dell'){
            return Promise.props({
                socketId: req.swagger.params.socket.value,
                hardware: dataFactory(identifier, 'hardware')
            }).then(function(data) {
                if(data.hardware.data.cpus.length <= data.socketId) {
                    throw new Errors.NotFoundError('invalid socketId');
                }
                return redfish.render('wsman.1.0.0.processor.1.0.0.json',
                                'Processor.v1_0_3.json#/definitions/Processor',
                                _.merge(options, data));
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else if(result.vendor === 'Cisco') {
            return Promise.props({
                socketId: req.swagger.params.socket.value,
                ucsData: dataFactory(identifier, 'UCS:board')
            }).then(function(data) {
                data.ucsData.data.children['cpu-collection']
                    = _.sortBy(data.ucsData.data.children['cpu-collection'], 'rn');
                if(data.ucsData.data.children['cpu-collection'].length <= data.socketId) {
                    throw new Errors.NotFoundError('invalid socketId');
                }
                options._ = _; //In this case, lodash is required in view
                return redfish.render('ucs.1.0.0.processor.1.0.0.json',
                                'Processor.v1_0_3.json#/definitions/Processor',
                                _.merge(options, data));
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return Promise.props({
                socketId: req.swagger.params.socket.value,
                catData: dataFactory(identifier, 'catData')
            }).then(function(data) {
                if(!_.has(data.catData.cpu, data.socketId)) {
                    throw new Errors.NotFoundError('invalid socketId');
                }
                return redfish.render('redfish.1.0.0.processor.1.0.0.json',
                                'Processor.v1_0_3.json#/definitions/Processor',
                                _.merge(options, data));
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        }
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Generate information about the storage adapters of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listSimpleStorage = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return redfish.getVendorNameById(identifier)
    .then(function(result){
        if(result.vendor === 'Dell'){
            return dataFactory(identifier, 'hardware')
            .then(function(hardware) {
                options.hardware = hardware;
                var controllers = new Set();
                _.forEach(hardware.data.storage.controllers, function(ele) {
                    var id = ele.fQDD.replace(/[:.]/g, '_');  // jshint ignore: line
                    controllers.add(id);
                });
                options.controllers = Array.from(controllers);

                return redfish.render('redfish.1.0.0.simplestoragecollection.json',
                                'SimpleStorageCollection.json#/definitions/SimpleStorageCollection',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else if(result.vendor === 'Cisco') {
            return dataFactory(identifier, 'UCS:board')
            .then(function(storage) {
                var controllers = [];
                var regexObj = /storage-(.*)-collection/;
                var allKeys = Object.keys(storage.data.children);
                _.forEach(allKeys, function(key) {
                    if (regexObj.test(key)) {
                        _.forEach(storage.data.children[key], function(ele) {
                            controllers.push(key.split('-')[1]
                                                + '_'
                                                + ele.pci_addr.replace(/[:.]/g, '_')
                                                + '_'
                                                + ele.id);
                        });
                    }
                });
                options.controllers = controllers;

                return redfish.render('redfish.1.0.0.simplestoragecollection.json',
                                'SimpleStorageCollection.json#/definitions/SimpleStorageCollection',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return Promise.all([ dataFactory(identifier, 'dmi'),
                                 dataFactory(identifier, 'smart') ])
                .spread(function(dmi, smart) {
                    options.dmi = dmi;

                var controllers = new Set();
                _.forEach(smart.data, function(ele) {
                    var id = ele.Controller.controller_PCI_BDF.replace(/[:.]/g, '_');
                    controllers.add(id);
                });
                options.controllers = Array.from(controllers);

                return redfish.render('redfish.1.0.0.simplestoragecollection.json',
                            'SimpleStorageCollection.json#/definitions/SimpleStorageCollection',
                            options);
           }).catch(function(error) {
               return redfish.handleError(error, res);
           });
        }
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Generate information about the storage devices on an adapter of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getSimpleStorage = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var index = req.swagger.params.index.value;
    var options = redfish.makeOptions(req, res, identifier);

    options.index = index;

    return redfish.getVendorNameById(identifier)
    .then(function(result){
        if(result.vendor === 'Dell'){
            return Promise.resolve(dataFactory(identifier, 'hardware'))
            .then(function(hardware) {
                options.hardware = hardware;
                var controllers = {};
                _.forEach(hardware.data.storage.controllers, function(ele) {
                    var id = ele.fQDD.replace(/[:.]/g, '_'); // jshint ignore: line
                    if(!(id in controllers)) {
                        controllers[id] = [];
                    }
                    controllers[id].push(ele);
                });

                options.controller = controllers[index][0];
                options.devices = [];
                _.forEach(hardware.data.storage.physicalDisks, function(ele) {
                    if(ele.fqdd.indexOf(options.controller.fQDD) !== -1) {
                        ele.size = ele.sizeInBytes.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " bytes";
                        options.devices.push(ele);
                    }
                });

                return redfish.render('wsman.1.0.0.simplestorage.1.0.0.json',
                                'SimpleStorage.v1_1_1.json#/definitions/SimpleStorage',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else if(result.vendor === 'Cisco'){
            return dataFactory(identifier, 'UCS:board')
                .then(function(catalogsData){
                    var controllerId = 'storage-' + index.split('_')[0] + '-collection';
                    if(catalogsData.data.children[controllerId] === undefined){
                        return Promise.reject(new Errors.NotFoundError('simplestorage contorller not found'));
                    }
                    _.forEach(catalogsData.data.children[controllerId], function(ele){
                        var newIndex = index.split('_')[0] + "_" + ele.pci_addr.replace(/[:.]/g, '_')
                                        + "_" + ele.id;
                        if(index === newIndex){
                            options.description = ele.model;
                            options.devices = ele.children['disk-collection'];
                            return false;
                        }
                    });
                    return redfish.render('ucs.1.0.0.simplestorage.1.1.1.json',
                                    'SimpleStorage.v1_1_1.json#/definitions/SimpleStorage',
                                    options);
                }).catch(function(error){
                    return redfish.handleError(error, res);
                });
        }
        else{
            return Promise.all([ dataFactory(identifier, 'dmi'),
                          dataFactory(identifier, 'smart') ])
                .spread(function(dmi, smart) {
                    options.dmi = dmi;
                    var controllers = {};
                    _.forEach(smart.data, function(ele) {
                        var id = ele.Controller.controller_PCI_BDF.replace(/[:.]/g, '_');
                        if(!(id in controllers)) {
                            controllers[id] = [];
                        }
                        controllers[id].push(ele);
                    });

                    options.controller = controllers[index][0].Controller;
                    options.devices = [];
                    _.forEach(controllers[index], function(ele) {
                        if(ele.SMART.Identity){
                            options.devices.push(ele.SMART);
                        }
                    });

                return redfish.render('redfish.1.0.0.simplestorage.1.0.0.json',
                            'SimpleStorage.v1_1_1.json#/definitions/SimpleStorage',
                            options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        }
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Generate information about the storage adapters of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listStorage = controller(function (req, res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);
    return wsman.isDellSystem(identifier)
        .then(function (result) {
            if (result.isDell) {
                return Promise.resolve(dataFactory(identifier, 'hardware'))
                    .then(function (hardware) {
                        options.hardware = hardware;

                        var controllers = {};
                        _.forEach(hardware.data.storage.controllers, function (ele) {
                            var id = ele.fQDD.replace(/[:.]/g, '_');  // jshint ignore: line
                            if (!(id in controllers)) {
                                controllers[id] = [];
                            }
                            controllers[id].push(ele);
                        });

                        var ids = [];
                        _.forOwn(controllers, function (val, key) {
                            ids.push(key);
                        });
                        options.controllers = ids;

                        return redfish.render('redfish.1.0.0.storagecollection.json',
                            'SimpleStorageCollection.json#/definitions/SimpleStorageCollection',
                            options);
                    }).catch(function (error) {
                        return redfish.handleError(error, res);
                    });
            } else {
                return Promise.resolve(dataFactory(identifier, 'Redfish'))
                    .then(function (redfishCatalog) {
                        if (redfishCatalog === undefined || redfishCatalog.length === 0) {
                            return Promise.all([dataFactory(identifier, 'dmi'),
                                dataFactory(identifier, 'smart')])
                                .spread(function (dmi, smart) {
                                    if (dmi === undefined && smart === undefined) {
                                        return;
                                    }
                                    options.dmi = dmi;

                                    var controllers = {};
                                    _.forEach(smart.data, function (ele) {
                                        var id = ele.Controller.controller_PCI_BDF.replace(/[:.]/g, '_');
                                        if (!(id in controllers)) {
                                            controllers[id] = [];
                                        }
                                        controllers[id].push(ele);
                                    });

                                    var ids = [];
                                    _.forOwn(controllers, function (val, key) {
                                        ids.push(key);
                                    });
                                    options.controllers = ids;

                                    return redfish.render('redfish.1.0.0.storagecollection.json',
                                        'SimpleStorageCollection.json#/definitions/SimpleStorageCollection',
                                        options);
                                }).catch(function (error) {
                                    return redfish.handleError(error, res);
                                });
                        }

                        var controllers = [];
                        _.forEach(redfishCatalog, function (ele) {
                            if (ele.data.Description === "Simple Storage Controller") {
                                controllers.push(ele.data.Id);
                            }

                        });
                        options.controllers = controllers;
                        return redfish.render('redfish.1.0.0.storagecollection.json',
                            'StorageCollection.json#/definitions/StorageCollection',
                            options);
                    }).catch(function (error) {
                        return redfish.handleError(error, res);
                    });

            }
        });
});

/**
 * Generate information about the storage devices on an adapter of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getStorage = controller(function (req, res) {
    var identifier = req.swagger.params.identifier.value;
    var index = req.swagger.params.index.value;
    var options = redfish.makeOptions(req, res, identifier);
    options.system = identifier;

    options.index = index;

    return wsman.isDellSystem(identifier)
        .then(function (result) {
            if (result.isDell) {
                return Promise.resolve(dataFactory(identifier, 'hardware'))
                    .then(function (hardware) {
                        options.hardware = hardware;
                        var controllers = {};
                        _.forEach(hardware.data.storage.controllers, function (ele) {
                            var id = ele.fQDD.replace(/[:.]/g, '_'); // jshint ignore: line
                            if (!(id in controllers)) {
                                controllers[id] = [];
                            }
                            controllers[id].push(ele);
                        });
                        options.controllers = [];
                        _.forEach(hardware.data.storage.controllers, function (ele) {
                            var speed = ele.possibleSpeed; //possibleSpeed format is X_X_GBS or X_GBS, convert to decimal
                            var speedInDecimal;
                            if (speed) {
                                speed = speed.split('_');
                                speed.splice(speed.length - 1, 1);
                                speedInDecimal = speed[0];
                                if (speed.length > 1) {
                                    speedInDecimal += "." + speed[1];
                                }
                            }
                            else {
                                speedInDecimal = 0;
                            }
                            ele.possibleSpeed = speedInDecimal;
                            options.controllers.push(ele);
                        });

                        options.drives = [];
                        _.forEach(hardware.data.storage.physicalDisks, function (ele) {
                            options.drives.push(ele);
                        });

                        return redfish.render('redfish.2016.3.storage.1.1.1.json',
                            'Storage.v1_1_1.json#/definitions/Storage',
                            options);
                    }).catch(function (error) {
                        return redfish.handleError(error, res);
                    });
            } else {
                return Promise.resolve(dataFactory(identifier, 'Redfish'))
                    .then(function (redfishCatalog) {
                        if (redfishCatalog === undefined || redfishCatalog.length === 0) {
                            return Promise.all([dataFactory(identifier, 'dmi'),
                                dataFactory(identifier, 'smart')])
                                .spread(function (dmi, smart) {
                                    options.dmi = dmi;
                                    var controllers = {};
                                    _.forEach(smart.data, function (ele) {
                                        var id = ele.Controller.controller_PCI_BDF.replace(/[:.]/g, '_');
                                        if (!(id in controllers)) {
                                            controllers[id] = [];
                                        }
                                        controllers[id].push(ele);
                                    });

                                    //It is assumed to have one controller per storage subsystem
                                    options.controllerArr = [controllers[index][0].Controller];

                                    options.devices = [];
                                    _.forEach(controllers[index], function (ele) {
                                        if (ele.SMART.Identity) {
                                            options.devices.push(ele.SMART);
                                        }
                                    });

                                    return redfish.render('redfish.1.0.0.storage.1.0.0.json',
                                        'Storage.v1_1_1.json#/definitions/Storage',
                                        options);
                                }).catch(function (error) {
                                    return redfish.handleError(error, res);
                                });

                        }
                        var controllers = [];
                        _.forEach(redfishCatalog, function (ele) {
                            if (ele.data.Id === options.index) {
                                controllers.push(ele.data);
                                options.devices = ele.data.Devices.slice(0);
                            }

                        });
                        options.controllers = controllers;
                        return redfish.render('redfish.1.0.0.redfishstorage.1.0.0.json',
                            'Storage.v1_1_1.json#/definitions/Storage',
                            options);
                    }).catch(function (error) {
                        return redfish.handleError(error, res);
                    });
            }

        });
});

/**
 * Generate information about the storage devices on an adapter of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getDrive = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var index = req.swagger.params.index.value;
    var driveIndex = req.swagger.params.driveIndex.value;
    var options = redfish.makeOptions(req, res, identifier);

    options.driveIndex = driveIndex;
    options.identifier = identifier;
    options.index = index;

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return Promise.resolve(dataFactory(identifier, 'hardware'))
            .then(function(hardware) {
                options.hardware = hardware;
                options.drive = hardware.data.storage.physicalDisks[driveIndex];
                options.volumeIds = [];
                //get redfish ids of all volumes related to this drive
                var currFqdd = hardware.data.storage.physicalDisks[driveIndex].fqdd;
                for(var i = 0; i < hardware.data.storage.virtualDisks.length; i+=1){
                    if (hardware.data.storage.virtualDisks[i].physicalDiskIds.indexOf(currFqdd) > -1){
                        options.volumeIds.push(i);
                    }
                }
                return redfish.render('redfish.2016.3.drive.1.1.1.json',
                                'Drive.v1_1_1.json#/definitions/Drive',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return Promise.resolve(dataFactory(identifier, 'smart'))
            .then(function(smart) {
                for( var i = 0; i < smart.data.length; i++) {
                    var drive = smart.data[i];
                    var id = drive.SMART.Identity["Serial number"] ? drive.SMART.Identity["Serial number"] : drive.SMART.Identity["Serial Number"];
                    if (index === drive.Controller.controller_PCI_BDF.replace(/[:.]/g, '_')) {
                        if (id === driveIndex && typeof drive.SMART.Identity["Rotation Rate"] !== 'undefined') {
                            return drive;
                        }
                    }
               }
               throw new Errors.NotFoundError('drive ' + driveIndex + ' was not found');
            })
            .then(function(drive) {
                var driveIdenity = drive.SMART.Identity;
                options.capacityBytes = Number(driveIdenity["User Capacity"].replace(/,/g, "").split(" ")[0]);
                options.serialNumber = driveIdenity["Serial number"] ? driveIdenity["Serial number"] : driveIdenity["Serial Number"];
                options.manufacturer = driveIdenity["Vendor"];
                options.blockSizeInBytes = (driveIdenity["Logical block size"] ? driveIdenity["Logical block size"] : driveIdenity["Sector Size"]).split(" ")[0];
                options.model = driveIdenity["Product"] ? driveIdenity["Product"] : driveIdenity["Device Model"];
                options.mediaType =  driveIdenity["Rotation Rate"].indexOf("Solid") >= 0 ? "SSD" : "HDD";
                options.protocol = driveIdenity["Transport protocol"];
                options.revision = driveIdenity["Revision"];
            })
            .then(function() {
                return redfish.render('redfish.1.0.0.drive.1.0.0.json',
                                      'Drive.v1_1_1.json#/definitions/Drive',
                                      options);

            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        }
    });
});

var listVolume = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var index = req.swagger.params.index.value;
    var options = redfish.makeOptions(req, res, identifier);

    options.identifier = identifier;
    options.index = index;
    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return Promise.resolve(dataFactory(identifier, 'hardware'))
            .then(function(hardware) {
                options.hardware = hardware;

                options.virtualDisks = [];
                _.forEach(hardware.data.storage.virtualDisks, function(ele) {
                    options.virtualDisks.push(ele);
                });
                return redfish.render('redfish.2016.3.volumecollection.json',
                                'VolumeCollection.json#/definitions/VolumeCollection',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return redfish.handleError("Not supported for non-Dell hardware.", res, null, 404);
        }
    });
});

/**
 * Generate information about the storage devices on an adapter of a specific system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getVolume = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var index = req.swagger.params.index.value;
    var volumeIndex = req.swagger.params.volumeIndex.value;
    var options = redfish.makeOptions(req, res, identifier);

    options.volumeIndex = volumeIndex;
    options.identifier = identifier;
    options.index = index;

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return Promise.resolve(dataFactory(identifier, 'hardware'))
            .then(function(hardware) {
                options.hardware = hardware;
                options.volume = hardware.data.storage.virtualDisks[volumeIndex];
                options.driveIds = [];
                //convert drive fqdds into the ids used for redfish
                _.forEach(hardware.data.storage.virtualDisks[volumeIndex].physicalDiskIds, function(ele){
                    for(var i = 0; i < ele.length; i+=1){
                        if (ele === hardware.data.storage.physicalDisks[i].fqdd){
                            options.driveIds.push(i);
                            break;
                        }
                    }
                });
                return redfish.render('redfish.2016.3.volume.1.0.2.json',
                                'Volume.v1_0_2.json#/definitions/Volume',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return redfish.handleError("Not supported for non-Dell hardware.", res, null, 404);
        }
    });
});

/**
 * Generate information about the log services available for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listLogService = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            options.logSource = ['SEL', 'lc'];
        } else {
            options.logSource = ['SEL'];
        }
        return redfish.render('redfish.1.0.0.logservicecollection.json',
                    'LogServiceCollection.json#/definitions/LogServiceCollection',
                    options)
        .catch(function(error) {
            return redfish.handleError(error, res);
        });
    });
});

/**
 * Generate information about the log service provider for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getSelLogService = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return wsman.isDellSystem(identifier)
    .then(function(result){
        var node = result.node;
        if(result.isDell){
            options.type = 'SEL';
            options.description = 'iDRAC System Event Log';
            options.name = 'idrac-sel-information';
            options.log = {};
            return wsman.getLog(node, options.type)
            .then(function(sel) {
                options.log.size = sel.length || 0;
                options.log.policy = 'WrapsWhenFull';
                options.log.lastWriteDate = sel.length > 0 ? sel[0].creationTimeStamp : 'Unknown';
                return redfish.render('redfish.1.0.0.logservice.1.0.0.json',
                                'LogService.v1_0_3.json#/definitions/LogService',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            options.type = 'SEL';
            options.description = 'IPMI System Event Log';
            options.name = 'ipmi-sel-information';
            options.log = {};

            return dataFactory(identifier, 'selInfoData')
                .then(function(sel) {
                    options.log.size = sel['# of Alloc Units'] || 0;
                    options.log.policy = sel.Overflow && sel.Overflow === 'false' ?
                        'WrapsWhenFull' :
                        'NeverOverWrites';
                    options.log.lastWriteDate = sel['Last Add Time'] || 'Unknown';
                    return redfish.render('redfish.1.0.0.logservice.1.0.0.json',
                                    'LogService.v1_0_3.json#/definitions/LogService',
                                    options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        }
    });
});

/**
 * Generate information about the log entries of a log service for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listSelLogServiceEntries = controller(function(req, res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    options.type = 'SEL';

    return wsman.isDellSystem(identifier)
    .then(function(result){
        var node = result.node;
        if(result.isDell){
            return wsman.getLog(node, options.type)
            .then(function(selData) {
                options.logEntries = selData;
                return redfish.render('wsman.1.0.0.logentrycollection.json',
                                'LogEntryCollection.json#/definitions/LogEntryCollection',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return dataFactory(identifier, 'selData')
            .then(function(selData) {
                if(selData) {
                    return selTranslator(selData, identifier);
                }
                return [];
            })
            .then(function(selData) {
                options.logEntries = selData;
                return redfish.render('redfish.1.0.0.logentrycollection.json',
                                'LogEntryCollection.json#/definitions/LogEntryCollection',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        }
    });
});

/**
 * Generate information about a specific log entry for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getSelLogServiceEntry = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var entryId = req.swagger.params.entryId.value;
    var options = redfish.makeOptions(req, res, identifier);

    options.type = 'SEL';
    options.description = 'IPMI System Event Log';
    options.name = 'ipmi-sel-information';
    options.log = {};

    return wsman.isDellSystem(identifier)
    .then(function(result){
        var node = result.node;
        if(result.isDell){
            return wsman.getLog(node, options.type)
            .then(function(selData) {
                options.entries = _.filter(selData, function(entry) {
                    return entry.recordID === entryId;
                });
                if(!options.entries.length) {
                    throw new Errors.NotFoundError('sel entry ' + entryId + ' was not found');
                }
                options.entry = options.entries[0];
                return redfish.render('wsman.1.0.0.logentry.1.0.0.json',
                            'LogEntry.v1_1_1.json#/definitions/LogEntry',
                            options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return dataFactory(identifier, 'selData')
            .then(function(selData) {
                options.entries = _.filter(selData, function(entry) {
                    return entry.logId === entryId;
                });
                if(!options.entries.length) {
                    throw new Errors.NotFoundError('SEL entry ' + entryId + ' was not found');
                }
                return selTranslator(options.entries, identifier);
            })
            .then(function(selData) {
                options.entries = selData;
                options.entry = options.entries[0];
                return redfish.render('redfish.1.0.0.logentry.1.0.0.json',
                                'LogEntry.v1_1_1.json#/definitions/LogEntry',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        }
    });
});

/**
 * Generate information about the log service provider for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getLcLogService = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return wsman.isDellSystem(identifier)
    .then(function(result){
        var node = result.node;
        if(result.isDell){
            options.type = 'LC';
            options.description = 'iDRAC Lifecycle Controller Log';
            options.name = 'idrac-lc-information';
            options.log = {};
            return wsman.getLog(node, options.type)
            .then(function(lc) {
                options.log.size = lc.length || 0;
                options.log.policy = 'WrapsWhenFull';
                options.log.lastWriteDate = lc.length > 0 ? lc[0].creationTimeStamp : 'Unknown';
                return redfish.render('redfish.1.0.0.logservice.1.0.0.json',
                                'LogService.v1_0_3.json#/definitions/LogService',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return redfish.handleError("Not implemented for non-Dell hardware.", res, null, 501);
        }
    });
});

/**
 * Generate information about the log entries of a log service for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listLcLogServiceEntries = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    options.type = 'LC';

    return wsman.isDellSystem(identifier)
    .then(function(result){
        var node = result.node;
        if(result.isDell){
            return wsman.getLog(node, options.type)
            .then(function(lcData) {
                options.logEntries = lcData;
                return redfish.render('wsman.1.0.0.lclogentrycollection.json',
                                'LogEntryCollection.json#/definitions/LogEntryCollection',
                                options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return redfish.handleError("Not implemented for non-Dell hardware.", res, null, 501);
        }
    });
});

/**
 * Generate information about a specific log entry for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var getLcLogServiceEntry = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var entryId = req.swagger.params.entryId.value;
    var options = redfish.makeOptions(req, res, identifier);

    options.type = 'LC';
    options.description = 'Lifecycle Controller Log';
    options.name = 'wsman-lc-information';
    options.log = {};

    return wsman.isDellSystem(identifier)
    .then(function(result){
        var node = result.node;
        if(result.isDell){
            return wsman.getLog(node, options.type)
            .then(function(lcData) {
                var id = parseInt(entryId);
                options.entries = _.filter(lcData, function(entry) {
                    return entry.recordId === id;
                });
                if(!options.entries.length) {
                    throw new Errors.NotFoundError('LC entry ' + entryId + ' was not found');
                }
                options.entry = options.entries[0];
                return redfish.render('wsman.1.0.0.lclogentry.1.0.0.json',
                            'LogEntry.v1_1_1.json#/definitions/LogEntry',
                            options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return redfish.handleError("Not implemented for non-Dell hardware.", res, null, 501);
        }
    });
});

/**
 * Generate information about available reset types for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listResetTypes = controller(function(req, res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return nodeApi.getNodeById(identifier)
    .then(function(node) {
        if(!node) {
            throw new Errors.NotFoundError('identifier not found');
        }

        return redfish.get('redfish.1.0.0.rackhd.reset.actions.json', options);
    })
    .catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Perform the specified reset operation on the system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var doReset = controller(function(req,res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);
    var payload = req.swagger.params.payload.value;

    return nodeApi.getNodeById(identifier)
    .then(function(node) {
        if(!node) {
            throw new Errors.NotFoundError('identifier not found');
        }

        return redfish.validateSchema(payload, 'RackHD.ResetAction.json#/definitions/ResetAction');
    })
    .then(function(result) {
        var map = {
            On: 'Graph.PowerOn.Node',
            ForceOff: 'Graph.PowerOff.Node',
            GracefulRestart: 'Graph.Reset.Soft.Node',
            ForceRestart: 'Graph.Reboot.Node',
            ForceOn: 'Graph.PowerOn.Node',
            PushPowerButton: 'Graph.Reset.Soft.Node'
        };

        if(result.error) {
            throw new Error(result.error);
        }

        if(!_.has(map, payload.reset_type))  {
            throw new Error('value not found in map');
        }
        return nodeApi.setNodeWorkflowById({
            name: map[payload.reset_type]
        }, identifier);
    })
    .then(function(data) {
        return {
            '@odata.id': options.basepath + '/TaskService/Tasks/' + data.instanceId
        };
    })
    .then(function(output) {
        res.setHeader('Location', output['@odata.id']);
        res.status(202).json(output);
    })
    .catch(function(error) {
        return redfish.handleError(error, res);
    });
});


/**
 * List the ethernet interfaces for specified system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listSystemEthernetInterfaces = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return wsman.isDellSystem(identifier)
    .then(function(result){
        options.name = "Systems Ethernet Interface Collection";
        if(result.isDell){
            return dataFactory(identifier, 'nics').then(function(nics) {
                options.baseprofile = 'Systems';
                options.net = [];

                _.forEach(nics.data, (function(data) {
                    options.net.push(data.fqdd);
                }));
                return options;
            });
        } else {
            return dataFactory(identifier, 'ohai').then(function(ohai) {
                options.baseprofile = 'Systems';
                options.net = [];

                _.forEach(Object.keys(ohai.data.network.interfaces), (function(key) {
                    options.net.push(key);
                }));
                return options;
            });
        }
    }).then(function(options) {
        return redfish.render('redfish.1.0.0.ethernetinterfacecollection.json',
                              'EthernetInterfaceCollection.json#/definitions/EthernetInterfaceCollection',
                              options);
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});


/**
 * List an ethernet interface by system and id
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listSystemEthernetInterfacesById = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);
    var index = req.swagger.params.index.value;

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return dataFactory(identifier, 'nics')
            .then(function(nics) {
                options.baseprofile = 'Systems';
                options.net = [];
                _.forEach(nics.data, function(data) {
                    if(data.fqdd === index) {
                        options.nic = data;
                    }
                });
                if(typeof options.nic === 'undefined') {
                    // raise an exception
                    throw new Errors.NotFoundError('No Ethernet index found for node ' + index);
                }
                return options;
            }).then(function(options) {
                options.name = "Systems Ethernet Interface";
                options.index = index;
                options.autoneg = autoNeg[options.nic.autoNegotiation];
                options.description = options.nic.deviceDescription;
                options.fullduplex = fullDuplex[options.nic.linkDuplex];
                options.linkstatus = options.nic.linkStatus;
                options.macaddress = options.nic.currentMACAddress;
                options.permanentmacaddress = options.nic.permanentMacAddress;
                options.speedmbps = linkSpeed[options.nic.linkSpeed];

                lookup.macAddressToIp(options.macaddress)
                .then(function(ipaddress) {
                    if (typeof ipaddress !== 'undefined') {
                        options.ipv4 = [];
                        var ip4 = {
                            ipaddr: ipaddress
                        };
                        options.ipv4.push(ip4);
                    }
                });
                return options;
            }).then(function(options) {
                return redfish.render('redfish.1.0.0.ethernetinterface.1.0.0.json',
                    'EthernetInterface.v1_2_0.json#/definitions/EthernetInterface',
                    options);
            });
        } else {
            return dataFactory(identifier, 'ohai')
            .then(function(ohai) {
                options.baseprofile = 'Systems';
                options.net = [];
                _.forEach(Object.keys(ohai.data.network.interfaces), function(key) {
                    if(key === index) {
                        options.nic = ohai.data.network.interfaces[key];
                    }
                });
                if(typeof options.nic === 'undefined') {
                    // raise an exception
                    throw new Errors.NotFoundError('No Ethernet index found for node ' + index);
                }
                return options;
            }).then(function(options) {
                options.name = "Systems Ethernet Interface";
                options.index = index;
                options.mtusize = options.nic.mtu;

                if ('addresses' in options.nic) {
                    _.forEach(Object.keys(options.nic.addresses), function(key) {
                       switch (options.nic.addresses[key].family)
                       {
                           case "lladdr":
                               options.macaddress = key;
                               break;
                            case "inet":

                                if (typeof options.ipv4 === 'undefined' ) {
                                    options.ipv4 = [];
                                }
                                var ip4 = {
                                    ipaddr: key,
                                    ipsubnet: options.nic.addresses[key].netmask
                                };
                                options.ipv4.push(ip4);
                                break;
                            case "inet6":
                                if (typeof options.ipv6 === 'undefined' ) {
                                    options.ipv6 = [];
                                }
                                var ip6 = {
                                    ipaddr: key,
                                    prefixlength: options.nic.addresses[key].prefixlen
                                };
                                options.ipv6.push(ip6);
                                break;
                            default:
                                break;
                        }
                    });
                }
                return options;

            }).then(function(options) {
                if (typeof options.macaddress !== 'undefined') {
                    lookup.macAddressToIp(options.macaddress)
                    .then(function(ipaddress) {
                        if (typeof ipaddress !== 'undefined') {
                            if (typeof options.ipv4 === 'undefined') {
                                options.ipv4 = [];
                                var ip4 = {
                                    ipaddr: ipaddress
                                };
                                options.ipv4.push(ip4);
                            } else {
                                options.ipv4[0].ipaddr = ipaddress;
                            }
                        } else {
                            if (typeof options.ipv4 !== "undefined") {
                                delete options.ipv4;
                            }
                            if (typeof options.ipv6 !== "undefined") {
                                delete options.ipv6;
                            }
                        }
                    });
                }
                return options;
            }).then(function(options) {
                return redfish.render('redfish.1.0.0.ethernetinterface.1.0.0.json',
                    'EthernetInterface.v1_2_0.json#/definitions/EthernetInterface',
                     options);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        }
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});


/**
 * Generate information about the available boot images for the system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var listBootImage = controller(function(req, res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return redfish.get('redfish.1.0.0.rackhd.bootimage.json', options)
    .catch(function(error) {
        return redfish.handleError(error, res);
    });
});

/**
 * Perform the boot image installation on the specified system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var doBootImage = controller(function(req,res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);
    var payload = req.swagger.params.payload.value;

    return redfish.validateSchema(payload, 'RackHD.BootImage.json#/definitions/BootImage')
    .then(function validatePayload(result) {
        if(result.error) {
            throw new Error(result.error);
        }

        var graphOptions = {
            defaults: payload
        };

        if( payload.osName.indexOf('+KVM') !== -1)  {
            graphOptions.defaults.kvm = true;
        }

        var graphName = '';
        if( payload.osName.indexOf('CentOS') !== -1)  {
            graphName = 'Graph.InstallCentOS';
            graphOptions.defaults.osName = 'CentOS';
        } else if(payload.osName.indexOf('ESXi') !== -1) {
            graphName = 'Graph.InstallESXi';
            graphOptions.defaults.osName = 'ESXi';
        } else if(payload.osName.indexOf('RHEL') !== -1) {
            graphName = 'Graph.InstallRHEL';
            graphOptions.defaults.osName = 'RHEL';
        } else {
            throw new Error('invalid osName');
        }

        return [ graphName, graphOptions ];
    }).spread(function launchTask(name, graphOptions) {
        return nodeApi.setNodeWorkflowById({ name: name, options: graphOptions }, identifier);
    }).then(function reportTask(data) {
        return {
            '@odata.id': options.basepath + '/TaskService/Tasks/' + data.instanceId
        };
    }).then(function(output) {
        res.setHeader('Location', output['@odata.id']);
        res.status(202).json(output);
    }).catch(function(error) {
        return redfish.handleError(error, res);
    });
});

var deleteVolume = controller(function(req,res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);
    var volumeIndex = req.swagger.params.volumeIndex.value;
    var payload = req.swagger.params.payload.value;
    var graphName = 'Graph.Delete.Volume';
    var graphOptions = {
        defaults: payload
    };
    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return Promise.resolve(dataFactory(identifier, 'hardware'))
            .then(function(hardware) {
                graphOptions.defaults.volumeId = hardware.data.storage.virtualDisks[volumeIndex].fqdd;
                graphOptions.defaults.ipAddress = hardware.data.id;
            }).then(function(){
                return nodeApi.setNodeWorkflowById({ name: graphName, options: graphOptions }, identifier);
            }).then(function reportTask(data) {
                return {
                    '@odata.id': options.basepath + '/TaskService/Tasks/' + data.instanceId
                };
            }).then(function(output) {
                res.setHeader('Location', output['@odata.id']);
                res.status(202).json(output);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return redfish.handleError("Not implemented for non-Dell hardware.", res, null, 501);
        }
    });
});

var addVolume = controller(function(req,res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);
    var payload = req.swagger.params.payload.value;
    var graphName = 'Graph.Add.Volume';
    var graphOptions = {
        defaults: {
            username: payload.username,
            password: payload.password
        }
    };

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return Promise.resolve(dataFactory(identifier, 'hardware'))
            .then(function(hardware) {
                var driveIndices = [];
                var i;
                for(i = 0; i < payload.volume.Links.Drives.length; i+=1)
                {
                    var odataId = payload.volume.Links.Drives[i]['@odata.id'].split('/');
                    var ind = odataId[odataId.length - 1];
                    driveIndices.push(ind);
                }
                if (driveIndices.length === 0){
                    throw new Error("No Drives specified for the Volume to use.");
                }
                graphOptions.defaults.ipAddress = hardware.data.id;
                graphOptions.defaults.name = payload.volume.Name;
                if (graphOptions.defaults.name.indexOf(" ") !== -1){
                     throw new Error("Virtual disk name cannot have spaces");
                }
                graphOptions.defaults.sizeInBytes = payload.volume.CapacityBytes;
                graphOptions.defaults.drives = "";
                for(i = 0; i < driveIndices.length; i+=1) {
                    if (driveIndices[i] >= hardware.data.storage.physicalDisks.length){
                        throw "No drive exists with id " + driveIndices[i];
                    }
                    graphOptions.defaults.drives += hardware.data.storage.physicalDisks[driveIndices[i]].fqdd;
                    if (i+1 < driveIndices.length){
                        graphOptions.defaults.drives += ',';
                    }
                }
                var raidLevel = payload.volume.VolumeType;
                switch(raidLevel)
                {
                    case "NonRedundant":
                        graphOptions.defaults.raidLevel = 'r0';
                        break;
                    case "Mirrored":
                        graphOptions.defaults.raidLevel = 'r1';
                        break;
                    case "StripedWithParity":
                        graphOptions.defaults.raidLevel = 'r5';
                        break;
                    case "SpannedMirrors":
                        graphOptions.defaults.raidLevel = 'r10';
                        break;
                    case "SpannedStripesWithParity":
                        graphOptions.defaults.raidLevel = 'r50';
                        break;
                    default:
                        throw "Invalid Raid Level for creating volume";
                }
            }).then(function(){
                return nodeApi.setNodeWorkflowById({ name: graphName, options: graphOptions }, identifier);
            }).then(function reportTask(data) {
                return {
                    '@odata.id': options.basepath + '/TaskService/Tasks/' + data.instanceId
                };
            }).then(function(output) {
                res.setHeader('Location', output['@odata.id']);
                res.status(202).json(output);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return redfish.handleError("Not implemented for non-Dell hardware.", res, null, 501);
        }
    });
});

var addHotspare = controller(function(req,res) {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);
    var driveIndex = req.swagger.params.driveIndex.value;
    var payload = req.swagger.params.payload.value;
    /*
    payload looks like for dhs:
    {
        username:
        password:
        volumeId:(fqdd of volume)

    }
    */
    var graphName = 'Graph.Add.Hotspare';
    var graphOptions = {
        defaults: payload
    };
    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return Promise.resolve(dataFactory(identifier, 'hardware'))
            .then(function(hardware) {
                graphOptions.defaults.driveId = hardware.data.storage.physicalDisks[driveIndex].fqdd;
                graphOptions.defaults.ipAddress = hardware.data.id;
                if(payload.hotspareType === 'dhs'){
                    //get volume fqqd using redfish path to volume
                    var volumeId = payload.volumeId.split('/');
                    var volumeIndex = volumeId[volumeId.length - 1];
                    if (hardware.data.storage.virtualDisks.length <= volumeIndex) {
                        throw "No Volume found with id " + volumeIndex;
                    }
                    graphOptions.defaults.volumeId = hardware.data.storage.virtualDisks[volumeIndex].fqdd;
                }
            }).then(function(){
                return nodeApi.setNodeWorkflowById({ name: graphName, options: graphOptions }, identifier);
            }).then(function reportTask(data) {
                return {
                    '@odata.id': options.basepath + '/TaskService/Tasks/' + data.instanceId
                };
            }).then(function(output) {
                res.setHeader('Location', output['@odata.id']);
                res.status(202).json(output);
            }).catch(function(error) {
                return redfish.handleError(error, res);
            });
        } else {
            return redfish.handleError("Not implemented for non-Dell hardware.", res, null, 501);
        }
    });
});

var getSecureBoot = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var options = redfish.makeOptions(req, res, identifier);

    return wsman.isDellSystem(identifier)
    .then(function(result){
        if(result.isDell){
            return getObmSettings(identifier)
                .then(function(obmSettings) {
                    return racadm.runCommand (
                        obmSettings.host,
                        obmSettings.user,
                        obmSettings.password,
                        'get bios.SysSecurity.SecureBoot'
                    );
                })
                .then(function(secureBoot) {
                    var secureBootSetting = _.words(secureBoot, /SecureBoot=[a-zA-Z]*/);
                    var statusArray = secureBootSetting[0].split('=');
                    options.SecureBoot = (statusArray[1]);
                    return redfish.render('redfish.1.0.0.secureboot.1.0.1.json',
                        'SecureBoot.v1_0_1.json#/definitions/SecureBoot',
                        options);
                });
        } else {
            return redfish.handleError("Not implemented for non-Dell hardware.", res, null, 501);
        }
    }).catch(function(error) {
        console.log('%j', error);
        return redfish.handleError(error, res);
    });
});

/**
 * Set UEFI Secure Boot status for a system
 * @param  {Object}     req
 * @param  {Object}     res
 */
var setSecureBoot = controller(function(req, res)  {
    var identifier = req.swagger.params.identifier.value;
    var command;
    if (req.body.SecureBootEnable) {
        command = "Enabled";
    } else {
        command = "Disabled";
    }
    return getObmSettings(identifier)
        .then(function(obmSettings) {
            return racadm.runCommand (
                obmSettings.host,
                obmSettings.user,
                obmSettings.password,
                'set bios.SysSecurity.SecureBoot ' + command
            );
        })
        .then(function() {
            res.status(202).json({"Message": "Successfully Completed Request"});
        })
        .catch(function(error) {
            return redfish.handleError(error, res);
        });
});

module.exports = {
    listSystems: listSystems,
    getSystem: getSystem,
    listSystemBios: listSystemBios,
    listSystemBiosSettings: listSystemBiosSettings,
    patchSystemBiosSettings: patchSystemBiosSettings,
    changeSystemBiosPassword: changeSystemBiosPassword,
    resetSystemBios: resetSystemBios,
    listSystemProcessors: listSystemProcessors,
    getSystemProcessor: getSystemProcessor,
    listSimpleStorage: listSimpleStorage,
    getSimpleStorage: getSimpleStorage,
    listStorage: listStorage,
    getStorage: getStorage,
    getDrive: getDrive,
    listVolume: listVolume,
    getVolume: getVolume,
    listLogService: listLogService,
    getSelLogService: getSelLogService,
    listSelLogServiceEntries: listSelLogServiceEntries,
    getSelLogServiceEntry: getSelLogServiceEntry,
    getLcLogService: getLcLogService,
    listLcLogServiceEntries: listLcLogServiceEntries,
    getLcLogServiceEntry: getLcLogServiceEntry,
    listResetTypes: listResetTypes,
    doReset: doReset,
    listBootImage: listBootImage,
    doBootImage: doBootImage,
    deleteVolume: deleteVolume,
    addVolume: addVolume,
    addHotspare: addHotspare,
    getSecureBoot: getSecureBoot,
    setSecureBoot: setSecureBoot,
    listSystemEthernetInterfaces: listSystemEthernetInterfaces,
    listSystemEthernetInterfacesById: listSystemEthernetInterfacesById
};
