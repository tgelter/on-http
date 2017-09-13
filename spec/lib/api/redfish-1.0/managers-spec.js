// Copyright 2016, EMC, Inc.
/* jshint node:true */

'use strict';

describe('Redfish Managers', function () {
    var tv4;
    var validator;
    var redfish;
    var waterline;
    var Promise;
    var view;
    var fs;
    var Errors;

    // Skip reading the entry from Mongo and return the entry directly
    function redirectGet(entry) {
        return fs.readFileAsync(__dirname + '/../../../../data/views/redfish-1.0/' + entry, 'utf-8')
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
        var nodeFs = helper.injector.get('fs');
        fs = Promise.promisifyAll(nodeFs);
        tv4 = require('tv4');
    });

    beforeEach('set up mocks', function () {
        this.sandbox.spy(tv4, "validate");
        this.sandbox.stub(view, "get", redirectGet);
        this.sandbox.spy(redfish, 'render');
        this.sandbox.spy(validator, 'validate');
        this.sandbox.stub(waterline.nodes);
        this.sandbox.stub(waterline.catalogs);

        waterline.nodes.needByIdentifier.withArgs('1234abcd1234abcd1234abcd')
        .resolves(Promise.resolve({
            id: '1234abcd1234abcd1234abcd',
            name: '1234abcd1234abcd1234abcd'
        }));

        waterline.nodes.getNodeById.withArgs('1234abcd1234abcd1234abcd')
        .resolves(Promise.resolve({
            id: '1234abcd1234abcd1234abcd',
            name: '1234abcd1234abcd1234abcd',
            identifiers: ['1234']
        }));

        waterline.nodes.getNodeById.withArgs('DELLabcd1234abcd1234abcd')
        .resolves(Promise.resolve({
            id: 'DELLabcd1234abcd1234abcd',
            name: 'DELLabcd1234abcd1234abcd',
            identifiers: ['ABCDEFG']
        }));

        waterline.nodes.needByIdentifier.withArgs('DELLabcd1234abcd1234abcd')
        .resolves(Promise.resolve({
            id: 'DELLabcd1234abcd1234abcd',
            name: 'DELLabcd1234abcd1234abcd'
        }));

        waterline.nodes.needByIdentifier.rejects(new Errors.NotFoundError('Not Found'));
        waterline.nodes.getNodeById.resolves([]);
        waterline.catalogs.findLatestCatalogOfSource.rejects(new Errors.NotFoundError());
    });

    helper.httpServerAfter();

    var node = {
        id: '1234abcd1234abcd1234abcd',
        name: 'name',
        type: 'compute',
        identifiers: ['12345'],
        obms: [{
            id: "574dcd5794ab6e2506fd107a",
            node: "1234abcd1234abcd1234abcd",
            service: 'ipmi-obm-service',
            config: {
                host: '1.2.3.4',
                user: 'myuser',
                password: 'mypass'
           }
        }],
        relations: [
            {
                relationType: 'enclosedBy',
                targets: [ '4567efgh4567efgh4567efgh' ]
            }
        ]
    };

    var dellNode = {
        id: 'DELLabcd1234abcd1234abcd',
        name: 'dell node',
        type: 'compute',
        identifiers: ['ABCDEFG'],
        obms: [{
            id: "1234abcd1234abcd1234abcd",
            node: "DELLabcd1234abcd1234abcd",
            service: 'ipmi-obm-service',
            config: {
                host: '1.2.3.4',
                user: 'myuser',
                password: 'mypass'
           }
        }],
        relations: [
            {
                relationType: 'enclosedBy',
                targets: [ '4567efgh4567efgh4567efgh' ]
            }
        ]
    };


    var catalogData = {
        'IP Address Source' : 'DHCP Address',
        'IP Address' : '127.0.0.1',
        'Subnet Mask' : '255.255.252.0',
        'MAC Address' : '00:01:02:03:04:05',
        'Default Gateway IP' : '0.0.0.0',
        '802_1q VLAN ID' : 'Disabled',
        'Firmware Revision' : '9.08',
        'Manufacturer Name' : 'Unknown (0x1291)',
        'Product Name' : 'Unknown (0xF02) ',
        'Port Type': 'Serial'
        };


    var dmiCatalogData = {
            'Port Connector Information': [{
                'Internal Reference Designator': 'J26-B2B_CONN_0',
                'Internal Connector Type': 'Other',
                'External Reference Designator': 'Not Specified',
                'External Connector Type': 'None',
                'Port Type': 'Other'
            },
                {
                    'Internal Reference Designator': 'Not Specified',
                    'Internal Connector Type': 'None',
                    'External Reference Designator': 'J21-COMA',
                    'External Connector Type': 'DB-9 male',
                    'Port Type': 'Serial Port 16550A Compatible'
                },
                {
                    'Internal Reference Designator': 'Not Specified',
                    'Internal Connector Type': 'None',
                    'External Reference Designator': 'J6-BMC_MANAGEMENT_PORT',
                    'External Connector Type': 'RJ-45',
                    'Port Type': 'Network Port'
                }]
        };



    it('should return a valid manager root', function () {
        waterline.nodes.find.resolves([node]);
        return helper.request().get('/redfish/v1/Managers')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid manager', function() {
        waterline.nodes.find.resolves([node]);
        waterline.nodes.needByIdentifier.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.nodes.getNodeById.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: '1234abcd1234abcd1234abcd',
            source: 'dummysource',
            data: catalogData
        }));

        return helper.request().get('/redfish/v1/Managers/' + node.id)
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });
    
    it('should return a valid idrac manager', function() {
        waterline.nodes.needByIdentifier.withArgs('DELLabcd1234abcd1234abcd').resolves(dellNode);
        waterline.nodes.getNodeById.withArgs('DELLabcd1234abcd1234abcd').resolves(dellNode);
        waterline.nodes.find.resolves([dellNode]);
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: 'DELLabcd1234abcd1234abcd',
            source: 'dummysource',
            data: catalogData
        }));
        return helper.request().get('/redfish/v1/Managers/' + dellNode.id)
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return a valid network protocol for idrac manager', function() {
        waterline.nodes.needByIdentifier.withArgs('DELLabcd1234abcd1234abcd').resolves(dellNode);
        waterline.nodes.getNodeById.withArgs('DELLabcd1234abcd1234abcd').resolves(dellNode);
        waterline.nodes.find.resolves([dellNode]);

        return helper.request().get('/redfish/v1/Managers/' + dellNode.id + '/NetworkProtocol')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });


    it('should 404 an invalid manager', function() {
        return helper.request().get('/redfish/v1/Managers/invalid')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid manager ethernet interface collection', function() {
        waterline.nodes.needByIdentifier.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.nodes.getNodeById.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: '1234abcd1234abcd1234abcd',
            source: 'dummysource',
            data: catalogData
        }));

        return helper.request().get('/redfish/v1/Managers/' + node.id + '/EthernetInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });
    
    it('should return a valid manager network protocol', function() {
        waterline.nodes.needByIdentifier.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.nodes.getNodeById.withArgs('1234abcd1234abcd1234abcd').resolves(node);

        return helper.request().get('/redfish/v1/Managers/' + node.id + '/NetworkProtocol')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should 404 an invalid manager ethernet interface collection', function() {
        return helper.request().get('/redfish/v1/Managers/invalid.0/EthernetInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return a valid manager ethernet interface', function() {
        waterline.nodes.needByIdentifier.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.nodes.getNodeById.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: '1234abcd1234abcd1234abcd',
            source: 'dummysource',
            data: catalogData
        }));

        return helper.request().get('/redfish/v1/Managers/' + node.id + '/EthernetInterfaces/0')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });
    
    it('should 404 an invalid manager ethernet interface', function() {
        return helper.request().get('/redfish/v1/Managers/invalid.0/EthernetInterfaces/0')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return the RackHD manager', function() {
        waterline.nodes.find.resolves([node]);
        return helper.request().get('/redfish/v1/Managers/RackHD')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should patch the RackHD manager', function() {
        waterline.nodes.find.resolves([node]);
        return helper.request().patch('/redfish/v1/Managers/RackHD')
            .send({ NetworkProtocol: { SSDP: { ProtocolEnabled: false }}})
            .expect(204);
    });

    it('should 405 a patch when it is not the RackHD manager', function() {
        return helper.request().patch('/redfish/v1/Managers/RackHD1')
            .expect('Content-Type', /^application\/json/)
            .send({ NetworkProtocol: { SSDP: { ProtocolEnabled: false }}})
            .expect(405);
    });

    it('should return the RackHD manager ethernet interface collection', function() {
        return helper.request().get('/redfish/v1/Managers/RackHD/EthernetInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return the RackHD manager network protocol', function() {
        return helper.request().get('/redfish/v1/Managers/RackHD/NetworkProtocol')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function() {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should return the RackHD manager ethernet interface', function() {
        return helper.request().get('/redfish/v1/Managers/RackHD/EthernetInterfaces')
        .then(function(res) {
            return Promise.map(res.body.Members, function(member) {
                return helper.request().get(member['@odata.id'])
                    .expect('Content-Type', /^application\/json/)
                    .expect(200);
            });
        });
    });

    it('should return 200 for non-DELL manager serial interface', function () {
        waterline.nodes.getNodeById.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: '1234abcd1234abcd1234abcd',
            source: 'dummysource',
            data: catalogData
        }));

        return helper.request().get('/redfish/v1/Managers/' + node.id + '/SerialInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function () {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });
 
    it('should return 200 for non-DELL manager serial interface with index', function () {
        waterline.nodes.getNodeById.withArgs('1234abcd1234abcd1234abcd').resolves(node);
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: '1234abcd1234abcd1234abcd',
            data: dmiCatalogData
        }));

        return helper.request().get('/redfish/v1/Managers/' + node.id + '/SerialInterfaces/J21-COMA')
            .expect('Content-Type', /^application\/json/)
            .expect(200)
            .expect(function () {
                expect(tv4.validate.called).to.be.true;
                expect(validator.validate.called).to.be.true;
                expect(redfish.render.called).to.be.true;
            });
    });

    it('should retrun 404 for Dell manager serial interface', function() {
        waterline.nodes.getNodeById.withArgs('DELLabcd1234abcd1234abcd').resolves(dellNode);
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: 'DELLabcd1234abcd1234abcd',
            source: 'dummysource',
            data: catalogData
        }));

        return helper.request().get('/redfish/v1/Managers/' + dellNode.id + '/SerialInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return 404 for Dell node manager serial interface with index', function() {
        waterline.nodes.getNodeById.withArgs('DELLabcd1234abcd1234abcd').resolves(dellNode);
        waterline.catalogs.findLatestCatalogOfSource.resolves(Promise.resolve({
            node: 'DELLabcd1234abcd1234abcd',
            source: 'dummysource',
            data: catalogData
        }));

        return helper.request().get('/redfish/v1/Managers/' + dellNode.id + '/SerialInterfaces/J21-COMA')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return 404 for RackHD manager serial interface', function() {
        waterline.catalogs.find.resolves(Promise.resolve({
            data: dmiCatalogData
        }));

        return helper.request().get('/redfish/v1/Managers/RackHD/SerialInterfaces')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

    it('should return 404 for RackHD manager serial interface with index', function() {
        waterline.catalogs.find.resolves(Promise.resolve({
            data: dmiCatalogData
        }));

        return helper.request().get('/redfish/v1/Managers/RackHD/SerialInterfaces/J21-COMA')
            .expect('Content-Type', /^application\/json/)
            .expect(404);
    });

});

