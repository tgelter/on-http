#!/bin/bash
set -e
curl -O http://<%=server%>:<%=port%>/api/current/templates/pxe-cloud-config.yml
sudo coreos-install -d <%=installDisk%> -c pxe-cloud-config.yml -b <%=repo%>

# Customizations for supporting CoreOS Ignition:
mkdir /mnt/coreos
mount <%=installDisk%>6 /mnt/coreos/
echo 'set linux_append="coreos.autologin coreos.first_boot=1 coreos.config.url=repo.loc.adobe.net/ethos/coreos/Test_Ignition_template.json"' > /mnt/coreos/grub.cfg

curl -X POST -H 'Content-Type:application/json' http://<%=server%>:<%=port%>/api/current/notification?nodeId=<%=nodeId%>
sudo reboot
set -e
curl -O http://<%=server%>:<%=port%>/api/current/templates/pxe-cloud-config.yml
sudo coreos-install -d <%=installDisk%> -c pxe-cloud-config.yml -b <%=repo%>
curl -X POST -H 'Content-Type:application/json' http://<%=server%>:<%=port%>/api/current/notification?nodeId=<%=nodeId%>
sudo reboot
