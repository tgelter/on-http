// Copyright 2015, EMC, Inc.

'use strict';

var di = require('di');

module.exports = ObmFactory;

di.annotate(ObmFactory, new di.Provide('Serializables.V1.Obm'));
di.annotate(ObmFactory,
    new di.Inject(
        'Promise',
        'Serializable',
        '_',
        'Services.Encryption'
    )
);

function ObmFactory (
    Promise,
    Serializable,
    _,
    encryption
) {
    function Obm (defaults) {
        Serializable.call(
            this,
            Obm.schema,
            defaults
        );
    }

    Obm.schema = {
        id: 'Serializables.V1.Obm',
        type: 'object',
        properties: {
            service: {
                type: 'string'
            },
            config: {
                type: 'object'
            }
        },
        required: [ 'service', 'config' ]
    };

    Serializable.register(ObmFactory, Obm);

    Obm.prototype.serialize = function (target) {
        this.defaults(target);

        _.forOwn(this.config, function (value, key, object) {
            switch (key) {
                case 'password':
                case 'community':
                    object[key] = 'REDACTED';
                    //object[key] = encryption.decrypt(object[key]);
                    break;

                default:
                    break;
            }
        });

        return Promise.resolve(this);
    };

    Obm.prototype.deserialize = function (target) {
        this.defaults(target);

        _.forOwn(this.config, function (value, key, object) {
            switch (key) {
                case 'password':
                case 'community':
                    object[key] = encryption.encrypt(value);
                    break;

                default:
                    break;
            }
        });

        return Promise.resolve(this);
    };

    return Obm;
}
